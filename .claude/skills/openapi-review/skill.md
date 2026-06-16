---
name: openapi-review
description: Audit and enrich a Control Plane OpenAPI spec file claim-by-claim against the handler code. Pre-commit gate for every per-kind spec under docs/users/api/openapi/control-plane/. The spec must mirror what the handlers actually implement — paths, verbs, types, status codes, IAM tiers — and carry the semantic layer only a human audit can supply: accurate field/operation descriptions, request/response examples, enum value sets, and the true required-field set. Trigger keywords: openapi review, openapi audit, review schema, audit api spec, enrich openapi, /openapi-review.
---

# openapi-review

Audit one OpenAPI spec file claim-by-claim against the control-plane handlers, then enrich it so an AI (or a partner) can understand and call the API correctly.

Use this skill when:

- About to commit a new or edited spec under `docs/users/api/openapi/control-plane/` (binding gate).
- Retroactively auditing a spec suspected of drift from its handler.
- Re-enriching a spec after a handler change altered the contract.

The handler code is the single source of truth. The spec must carry both the **structural** layer (paths, verbs, field names/types, optionality, status codes, IAM action + tier — everything the code proves) and the **semantic** layer (enum value sets held in `validXxx` maps, "field is required" checks, cross-field rules, human-readable descriptions and examples). This skill verifies the first and fills the second.

---

## Division of truth (binding)

- **Handlers own the contract.** Paths, HTTP verbs, request/response field names + types, path parameters, status codes, `x-nexus-iam-action`, `x-nexus-tier` in the spec must match what the handler code under `packages/control-plane/**` enforces. If the spec disagrees with the handler, the spec is wrong — fix the spec (or, if the handler itself is defective, report it as a system issue; see Hard rule 7).
- **This skill owns semantics.** `summary`, `description` (operation + per-field), `examples`, `enum`, the corrected `required` set, and any `x-nexus-*` clarification. These are enriched in place.

---

## Hard rules

A spec file is CLEAN only if it satisfies ALL of:

1. **Code-anchored.** Every path, verb, field, enum value, status code, and required-flag traces to handler code that exists on disk right now (`packages/control-plane/**`). Cite the handler for each.
2. **No fabricated fields or enums.** An `enum` may only list values the handler actually accepts — found in a `validXxx` map, a `switch`, or a `oneof`/membership check. If you cannot find the value set in code, do NOT invent one; leave the field free and note it.
3. **`required` reflects handler validation.** The required set is exactly the fields the handler rejects when absent (the `"X is required"` checks) — not a guess from field types. Remove over-marked entries; add any field the handler demands.
4. **IAM extensions match the handler's `iamMW(...)` wiring.** `x-nexus-iam-action` / `x-nexus-tier` must mirror the IAM middleware on the route. If one looks wrong, verify against the route registration and report a mismatch as a system issue rather than silently editing.
5. **No unresolved-type markers left behind.** Any `x-nexus-unresolved-*` marker means a type was never mapped to a real schema. Resolve it by reading the Go type, or report it.
6. **English-only**, timeless prose. No dates, no Epic/SDD/bug/PR references, no line numbers in descriptions.
7. **Surfaces system issues, not just spec issues.** If per-operation verification reveals a handler problem — a route with no validation, a response shape that contradicts the model, a dead field the UI anticipates — output it with: (a) finding, (b) code evidence, (c) recommended fix, (d) next action. The audit is the cheapest checkpoint.

Any violation = DRIFTED or FABRICATION verdict on that operation.

---

## The 5-pass audit

Run per spec file. `SPEC=docs/users/api/openapi/control-plane/<kind>.yaml`.

### Pass 1 — Mechanical sweep

```bash
SPEC=<spec-path>

# Valid YAML + OpenAPI 3.1 shell
python3 -c "import yaml,sys; d=yaml.safe_load(open('$SPEC')); assert d['openapi']=='3.1.0'; assert 'paths' in d" \
  || echo "DRIFT: not a valid 3.1 document"

# Unresolved-type markers must be gone
grep -nE 'x-nexus-unresolved-(type|basic)' "$SPEC" && echo "DRIFT: unresolved type markers remain"

# Every $ref resolves inside components.schemas
grep -oE '#/components/schemas/[A-Za-z0-9_]+' "$SPEC" | sort -u | while read r; do
  name=${r##*/}
  grep -qE "^        $name:" "$SPEC" || echo "MISSING component: $name"
done

# No dates / program refs / line numbers in prose
grep -nE '20[0-9]{2}-[0-9]{2}|\bE[0-9]+(-S[0-9]+)?\b|\bPR #?[0-9]+|\.(go|ts):[0-9]+' "$SPEC" \
  && echo "DRIFT: dates/program-refs/line-numbers found"

# Every operation still carries its code-derived extensions
python3 - "$SPEC" <<'PY'
import yaml,sys
d=yaml.safe_load(open(sys.argv[1]))
for p,item in d.get('paths',{}).items():
    for m,op in item.items():
        if 'x-nexus-tier' not in op: print(f"DRIFT: {m.upper()} {p} missing x-nexus-tier")
PY
```

Cross-check the file's operation set against `_index.yaml` for the same kind — a path/verb present in one but not the other means the two files were edited out of sync.

### Pass 2 — Per-operation audit (independent sub-agent)

Dispatch a `general-purpose` sub-agent (Read + grep). Feed it the spec file, the mechanical-pass output, and the kind. It resolves each operation's handler via the `operationId` (which is the Go handler name, e.g. `createQuotaPolicy` → `CreateQuotaPolicy`) and verifies + drafts enrichment.

**Required sub-agent prompt structure:**

```
You are a strict code-anchored OpenAPI auditor. Worktree: <path>.

Audit <spec-path> operation-by-operation against the control-plane
handlers under packages/control-plane/**. For EACH operation:

1. Find the handler. operationId is the Go handler name; grep for it
   (e.g. `func (h *Handler) CreateQuotaPolicy`). Cite file:line in your
   report (NOT in the spec).
2. Verify structure against the handler:
   - request body fields == the struct passed to c.Bind (names, types,
     optionality).
   - response status codes == the codes in c.JSON calls.
   - the success-response schema == the type returned on 200/201.
   Verdict each: VERIFIED / DRIFTED / FABRICATION. Propose the concrete
   spec correction for each structural drift.
3. Draft semantic enrichment grounded in the handler:
   - operation summary + description (what it does, from the handler).
   - per-field description for non-obvious fields.
   - enum: the exact value set the handler validates against. Quote the
     validXxx map / switch / membership check. NO invented values.
   - required: the fields the handler rejects when absent ("X is
     required" checks). Nothing else may be marked required.
   - one realistic request example + one response example, values
     consistent with the field types and enums.

Hard rules: enum/required must cite handler code; x-nexus-iam-action /
x-nexus-tier must match the route's IAM wiring; English-only; no
dates/line-numbers in spec prose.

Report under 900 words: per-operation verdict + the concrete enrichment
YAML to splice in. End with CLEAN or N issues.
```

### Pass 3 — Apply corrections + triage

- **FABRICATION / structural DRIFT** → fix the spec to match the handler. If the handler itself looks defective, additionally report it as a system issue (Hard rule 7); do not paper over it in the spec.
- **Semantic enrichment** → splice the sub-agent's drafted `summary` / `description` / `enum` / corrected `required` / `examples` into the spec, preserving the structural fields and the `x-nexus-*` extensions.
- Verify each enum/required edit cites a handler check; drop any the sub-agent could not ground in code.

### Pass 4 — Re-run if substantial

If you applied corrections or enrichment to more than ~3 operations or removed any fabrication, re-dispatch Pass 2 on the edited file. Edits can introduce their own drift (a wrong enum value, an example that violates the schema).

### Pass 5 — Verdict + handoff

```
openapi-review: <spec-path>
  Pass 1 (mechanical): N hits → fixed
  Pass 2 (per-operation): N ops verified, N enriched, N structural defects → fixed
  Pass 4 (re-audit): CLEAN
  Verdict: CLEAN, ready to commit
```

A non-CLEAN verdict blocks commit of that spec.

---

## Anti-patterns to refuse

- Inventing enum values or examples that "look right" — every enum traces to a `validXxx` map / membership check, or it does not go in.
- Marking fields `required` from type shape alone — always derive from handler validation.
- Editing `x-nexus-iam-action` / `x-nexus-tier` without verifying against the route's IAM middleware wiring.
- Declaring CLEAN after only the mechanical pass. The per-operation handler cross-check is where real drift and the enum/required corrections surface.
- Enriching a field with a description that restates its name ("the name field"). Describe its role and constraints from the handler, or leave it.
