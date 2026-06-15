# Spillstore architecture

The spillstore is where the audit pipeline keeps captured request/response bodies
that are too large to carry inline in PostgreSQL. AI workloads make this routine:
a single large-context request or a long streamed response can reach several MiB,
far past what belongs in a hot-path JSONB column. The spillstore is a small,
pluggable abstraction — local filesystem or S3 — that holds those bytes
out-of-band, leaving the audit row with only a compact reference.

How bodies are captured and emitted into the audit pipeline is covered in
[audit-pipeline-architecture.md](../observability/audit-pipeline-architecture.md);
this doc covers the store itself — the interface, the backends, the upload path,
and retention.

## 1. Two-tier body storage

Every captured body takes one of two paths, decided by size:

- **Inline** — bodies below the cutoff travel on `traffic_event_payload` as JSONB
  (base64-encoded on the wire). Fast to write and to read back for the admin UI.
- **Spilled** — bodies at or above the cutoff are written to a `SpillStore`
  backend, and the audit row carries only a `SpillRef` (backend name, storage key,
  SHA-256). The bytes never touch the database.

The cutoff is `MaxInlineBodyBytes` on the payload-capture config (default 256 KiB,
admin-tunable through the payload_capture shadow). It is deliberately *not* a
spillstore setting: the inline-vs-spill threshold is an admin concern, while the
spillstore owns only where spilled bytes land and how long they live. The emit
helper (`packages/shared/storage/spillstore/emit.go`) applies the rule: with no
store configured, or a body below the cutoff, it emits inline; otherwise it writes
to the store and emits a spill reference, falling back to inline if the write
fails so a storage outage never drops the audit row.

## 2. The `SpillStore` interface

`packages/shared/storage/spillstore/spillstore.go` defines the cross-service
contract, intentionally minimal so a new backend is a drop-in:

- `Put(content, size, opts)` — stores the bytes and returns a `SpillRef`. Every
  backend hashes the content with SHA-256 and stamps the hex digest onto the ref.
- `Get(ref)` — opens a reader over a stored object (`ErrNotFound` when the ref no
  longer resolves, which callers treat as "already gone").
- `Delete(ref)` — removes an object.
- `Sweep(olderThan)` — deletes objects past the retention horizon, oldest first,
  and may also enforce a total-size ceiling.
- `Stat()` — backend name, object count, total bytes, oldest/newest timestamps,
  for admin and metrics.
- `Backend()` — the canonical backend name stamped onto every `SpillRef`.

A backend may additionally implement the optional `Presigner` capability
(`PresignPut` + `KeyFor`). The S3 backend does; the localfs backend does not (it
returns `ErrPresignNotSupported`). The Hub's upload-mint endpoint type-asserts the
store to `Presigner` to decide between handing back an S3 URL and falling back to
its own in-Hub upload sink.

## 3. Backends and the factory

`packages/shared/storage/spillstore/spillfactory` builds a store from the
per-service YAML `spill:` block. Its `FactoryConfig` is the operator-facing
configuration:

- `enabled` — gates the whole subsystem. When false the factory returns no store
  and every body stays inline regardless of size.
- `backend` — `localfs` (default) or `s3`.
- `localfs` / `s3` — backend-specific options: storage location, per-object cap,
  total-size cap, retention days.
- `async` — wraps the backend so `Put` returns as soon as the key, hash, and size
  are known, with the actual upload running on a background worker.

### localfs

The reference backend writes objects under a configured root directory. All
services in one deployment that share a localfs store must point at the same root
(a shared volume) so any service's spilled bytes are readable by the reader path.

### s3

The S3 backend stores each object at `<prefix>/<date>/<event-id>-<direction>.bin`
— the same date-prefixed layout localfs uses, so retention sweeps work the same
way on both. It signs the SHA-256 checksum into uploads so S3 rejects a body that
does not match. Credentials come from the AWS SDK default chain (IAM role,
environment, or profile); access keys are never plumbed through YAML. The backend
also works against S3-compatible stores (MinIO, Ceph, R2) via a custom endpoint
and path-style addressing.

### async wrapper

For S3, where a `PutObject` round-trip can add hundreds of milliseconds to a
request, the async wrapper moves the upload off the hot path: `Put` computes the
ref synchronously and queues the bytes for a background worker. The trade-off is
durability — queued-but-not-yet-uploaded bodies are held in memory and lost on a
crash, leaving a `SpillRef` that points at an object that never landed. A later
read of that ref returns not-found, which matches the at-most-once guarantee the
audit pipeline already makes. Services should close the store on shutdown to drain
the queue.

### Per-object cap

Each backend enforces a hard per-object ceiling (256 MiB by default). The
producer-side streaming capture also reads this cap to bound in-memory growth on
long streamed responses, independent of the inline-vs-spill cutoff.

## 4. The upload path

A service that runs its own backend — the AI Gateway and Compliance Proxy — writes
spilled bodies directly to that backend. The agent cannot: it sits behind NAT with
no Hub-reachable storage, so it spills through the Hub. The agent keeps a local
localfs store for oversize bodies and pushes them to the Hub via a two-step mint
and upload:

1. **Mint** — `POST /api/internal/things/spill-uploads`, authenticated by the
   agent's mTLS thing identity. The agent sends the event id, direction, size,
   content type, and the body's SHA-256. The Hub validates the request (including
   the per-object cap, which rejects oversize bodies with 413), derives the storage
   key, and signs a one-shot HMAC upload token. **The key is namespaced by the
   authenticated node identity** — `<nodeId>/<day>/<eventId>-<direction>.bin` for a
   device caller — and the `nodeId` plus the exact key are bound into the signed
   token (SEC-M5-01). It then returns either an S3 presigned URL (when the backend
   is S3) or an in-Hub blob URL carrying the token (when the backend is localfs).
2. **Upload** — for S3 the agent `PUT`s the bytes straight to the presigned URL.
   For localfs the agent `PUT`s to `/api/internal/spill/blob/:token`, a Hub sink
   that authorizes on the HMAC token alone (the mTLS identity was already verified
   at mint), requires the `Content-Length` to match the token's size, enforces
   one-shot use with a Redis dedup key (a replayed token gets 409), streams the
   body into **the exact node-namespaced key the token signed** (the localfs store
   honours `PutOptions.Key` rather than re-deriving a shared key — SEC-M5-01) while
   recomputing the SHA-256, and rejects (and deletes) a body whose hash does not
   match the token.

**Cross-node tamper resistance (SEC-M5-01).** Because the storage key is
node-namespaced and HMAC-bound, one node can never address — let alone overwrite —
another node's spill object: node A minting for node B's `eventId` produces a key
under `A/…`, which is orphaned (B's `traffic_event` references B's key). Direct
in-process spillers (ai-gateway / compliance-proxy, holding the high-trust service
token) keep the flat key. **On read**, the Control Plane's `resolveSpillBody`
recomputes the SHA-256 of the fetched bytes and refuses to serve a body whose hash
does not match the `sha256` recorded on the `traffic_event`, so even a tampered
at-rest blob can never be presented as the genuine captured request/response.

The Hub never decides *whether* to spill — that is the data plane's call. The
upload API is pure infrastructure: token minting and a token-gated sink.

## 5. Retention

Each backend bounds its own footprint with three controls, all set per backend in
the `spill:` config block. The per-object cap (256 MiB default) bounds any single
write — the producer-side capture clips at the cap, and the agent upload mint
rejects an over-cap body outright. The total-size cap (50 GiB localfs / 10 GiB S3
default) and the retention horizon (30-day default) are enforced by `Sweep`, which
deletes objects past the horizon and evicts oldest-first to hold the total under
the cap.

Because a `SpillStore` is process-local, each service that owns one runs its own
periodic sweep (`packages/shared/storage/spillstore/spillsweep`): the loop calls
`Sweep` on startup and then on an interval, passing `now − RetentionHorizon`. A
localfs store is swept by the process that owns its directory; a shared S3 bucket
is swept by every process pointed at it, which is safe because `Sweep` is
idempotent. The retention horizon comes from the backend's `retentionDays`
(defaulting to 30 days); the agent's fixed local store uses the same default. This
runs alongside, not instead of, any backend-native lifecycle (an S3 bucket
lifecycle rule remains a fine belt-and-suspenders for age-based expiry).

## 6. Configuration ownership

Two configs govern the spill subsystem, split by audience:

- **Operator** — the `spill:` YAML block (`FactoryConfig`): which backend, where it
  stores, the caps, retention, and async. These are deployment concerns.
- **Admin** — `MaxInlineBodyBytes` on the payload_capture shadow: the inline-vs-spill
  cutoff. This is a runtime policy concern, tunable without a redeploy.

Keeping the cutoff out of the backend config means an admin can change how much
body travels inline without touching where spilled bytes are stored.

## References

- `packages/shared/storage/spillstore/spillstore.go` — `SpillStore` + `Presigner` interfaces, `SpillRef`
- `packages/shared/storage/spillstore/emit.go` — inline-vs-spill emit helper
- `packages/shared/storage/spillstore/spillfactory/factory.go` — `FactoryConfig` + backend construction
- `packages/shared/storage/spillstore/localfs/` — localfs backend
- `packages/shared/storage/spillstore/s3/` — S3 backend + presign
- `packages/shared/storage/spillstore/async/` — async upload wrapper
- `packages/shared/storage/spillstore/spillsweep/` — per-service periodic sweep loop
- `packages/shared/audit/body.go` — `Body` / `SpillRef` shapes
- `packages/nexus-hub/internal/traffic/ingest/spill/spill_uploads.go` — agent mint + blob upload endpoints
- `packages/agent/cmd/agent/wiring/bridgedeps.go` — agent local spill store wiring
