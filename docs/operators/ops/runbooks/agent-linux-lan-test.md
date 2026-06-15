# Linux agent LAN interception test

End-to-end check of a Linux Nexus Agent against a Hub reachable over the LAN.
It exercises the full agent data path: enrollment, config sync, the iptables
transparent-redirect chain, MITM inspection of an AI-provider call, and the
resulting traffic record on the Hub. Use it after building a new agent package,
after touching the Linux platform code, or to validate a node on a fresh host.

Placeholders used below:

- `<stack-host>` — the machine running the Hub + Control Plane + AI Gateway +
  Compliance Proxy (e.g. a developer workstation). `<stack-lan-ip>` is its
  LAN address.
- `<agent-host>` — the Linux machine the agent runs on. The two must be on the
  same network and able to reach each other.
- `<version>` — the agent package version, e.g. `1.0.5`.

## What it verifies

- The agent enrolls against the Hub over the LAN and registers as an online
  node.
- The reconciler installs the `NEXUS_AGENT` iptables chain (IPv4 + IPv6) and
  the proxy listens on `127.0.0.1:19080` / `[::1]:19080`.
- An outbound call to an interception domain is captured, MITM-decoded, and
  recorded as a `traffic_event` with `source='agent'` on the Hub.

## 1. Bring up the stack and expose the Hub on the LAN

The Hub binds all interfaces by default, so it is already LAN-reachable; only
its advertised URLs need to point at the LAN IP so anything it reports back is
resolvable from `<agent-host>`. In `packages/nexus-hub/nexus-hub.dev.yaml`:

```yaml
publicURL: "http://<stack-lan-ip>:3060"
hub:
  advertiseAddr: "<stack-lan-ip>:3060"
```

Bootstrap and start the services with `scripts/dev-start.sh`, then confirm the
Hub answers from `<agent-host>`:

```bash
# on <agent-host>
curl -m6 -o /dev/null -w 'HTTP %{http_code}\n' http://<stack-lan-ip>:3060/healthz   # expect 200
```

Ensure the host firewall on `<stack-host>` allows inbound `3060`.

## 2. Install the agent on the target host

Pick the package for the distro; all three wrap the same portable binary built
by `packages/agent/platform/linux/scripts/build-server.sh`:

| Distro family | Package | Install |
|---|---|---|
| Ubuntu / Mint / Debian | `nexus-agent_<version>_amd64.deb` | `sudo apt install -y ./nexus-agent_<version>_amd64.deb` |
| Fedora / CentOS / RHEL / Rocky / Alma | `nexus-agent-<version>-1.x86_64.rpm` | `sudo dnf install -y ./nexus-agent-<version>-1.x86_64.rpm` |
| Arch / Manjaro | `nexus-agent-<version>-1-x86_64.pkg.tar.zst` | `sudo pacman -U ./nexus-agent-<version>-1-x86_64.pkg.tar.zst` |

The post-install step creates the `nexus-agent` system user, generates the
device CA and installs it into the OS trust store, and enables (does not start)
the systemd service. Confirm:

```bash
nexus-agent version        # version=<version> commit=<rev> built=<utc>
```

## 3. Configure the Hub URL, enroll, start

```bash
# point the agent at the LAN Hub
sudo sed -i \
  's|^hubURL: .*|hubURL: "ws://<stack-lan-ip>:3060/ws"|; s|^hubHTTPURL: .*|hubHTTPURL: "http://<stack-lan-ip>:3060"|' \
  /etc/nexus-agent/agent.yaml

# mint an enrollment token on <stack-host> via the admin API, then:
sudo nexus-agent enroll --hub-url http://<stack-lan-ip>:3060 --token <token> \
  --config /etc/nexus-agent/agent.yaml
sudo chown -R nexus-agent:nexus-agent /var/lib/nexus-agent   # enroll runs as root

sudo systemctl start nexus-agent
```

Confirm interception is live:

```bash
sudo iptables -t nat -S NEXUS_AGENT | head        # mark RETURN / loopback RETURN / REDIRECT --to-ports 19080
sudo iptables -t nat -S OUTPUT | grep NEXUS_AGENT  # -A OUTPUT -j NEXUS_AGENT
sudo ss -ltnp | grep 19080                         # 127.0.0.1:19080 and [::1]:19080
```

## 4. Drive an intercepted AI call and verify the record

Call an interception domain with a real provider key. The agent terminates the
TLS, decodes the request, and forwards it upstream; the device CA is already in
the OS trust store, so the co-located client trusts the agent's leaf.

```bash
curl -sS https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer <provider-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"agent intercept test"}]}'
```

On `<stack-host>`, confirm the node is online and the traffic was recorded:

```bash
# node online
docker exec nexus-postgres psql -U postgres -d nexus_gateway -tA -c \
  "SELECT id,type,status FROM thing WHERE type='agent' AND status='online'"
# the intercepted call
docker exec nexus-postgres psql -U postgres -d nexus_gateway -x -c \
  "SELECT source,target_host,method,path,status_code FROM traffic_event
     WHERE source='agent' ORDER BY timestamp DESC LIMIT 1"
```

In the Control Plane UI (`http://localhost:3000` on `<stack-host>`), the same
record appears under the traffic view filtered to `source=agent` / the node.
The automated equivalent of this whole flow is the `S-155` scenario
(`tests/scenarios/agent_intercept_container_test.go`).

## 5. Cleanup

The agent's redirect chain is host-wide, so stop it when finished:

```bash
sudo systemctl stop nexus-agent     # tears down the chain; restores normal egress
sudo systemctl disable nexus-agent  # optional: do not start on boot
```

## Troubleshooting

- **`curl: (77) error setting certificate file: /var/lib/nexus-agent/device-ca.pem`** —
  a login shell sourced `/etc/profile.d/nexus-agent-ca.sh`, which sets
  `SSL_CERT_FILE` to the device CA for tools that bundle their own trust store
  (Node, Python); that file lives in a directory readable only by the
  `nexus-agent` user (mode `0750`). curl does not need
  it — the device CA is already in the OS trust store. Run `unset SSL_CERT_FILE`
  (or point it at `/etc/ssl/certs/ca-certificates.crt`).
- **No `traffic_event` after a request** — only inspected flows are uploaded at
  the default upload level; passthrough flows are not. Call an interception
  domain (an AI provider host the Hub configured), not an arbitrary endpoint.
- **Intercepted call hangs then fails** — the agent forwards to the real
  provider using the client's own credentials, so the request only succeeds if
  `<agent-host>` can actually reach that provider. On a network that poisons DNS
  for the provider, give the host a clean resolver or reachable route; the agent
  records the attempt regardless of the upstream outcome.
- **Plain-HTTP egress while the agent runs** — handled transparently
  (passed through); if a host process relies on plain HTTP and behaves oddly,
  stop the agent to confirm whether it is in the path.
- **Hosts with nft-managed `nat` tables (k8s / docker / libvirt)** — supported;
  the reconciler installs its chain through the `iptables-nft` shim.

## References

- `docs/developers/architecture/services/agent/agent-linux-platform-architecture.md` — agent Linux platform architecture
- `packages/agent/internal/platform/linux/` — listener, reconciler, `SO_ORIGINAL_DST`, `/proc` attribution, health
- `packages/agent/platform/linux/scripts/build-server.sh` — build the deb/rpm/arch server packages
- `packages/agent/cmd/agent/cmd_enroll.go` — `enroll` command
- `tests/scenarios/agent_intercept_container_test.go` — S-155 automated containerized interception scenario
