---
name: linux-agent-deploy
description: >
  Install, enroll, start, and troubleshoot the Linux Nexus Agent on a target
  host until it connects to the Hub, installs the iptables redirect chain,
  listens on 19080, and produces traffic_event rows. Encodes every real failure
  mode hit deploying to an Ubuntu server and a kernel-6.17 Docker desktop on a
  censored (GFW) network: pending-enrollment (enroll skipped), "Incompatible
  with this kernel" (iptables-nft vs legacy on new kernels), xtables.lock
  permission, missing nat modules, SO_MARK self-loop 502s, PeekSNI plain-HTTP
  stall, SSL_CERT_FILE / browser-CA trust, DNS poisoning (DoT), TLS-SNI reset +
  egress proxy, QUIC/HTTP3 bypass, and local-proxy loopback bypass. Trigger
  keywords: deploy linux agent, install nexus-agent on linux, agent won't
  connect, agent not intercepting, no 19080, iptables Incompatible with this
  kernel, agent enrollment, browser chatgpt not monitored, agent 502,
  /linux-agent-deploy.
---

# linux-agent-deploy

Drive a Linux Nexus Agent from a fresh box to a working, monitored node. The
end state is verifiable: the node is **online** on the Hub, the `NEXUS_AGENT`
iptables chain is installed, `127.0.0.1:19080` + `[::1]:19080` are listening,
and a request to an interception domain produces a `traffic_event` with
`source='agent'`.

This skill does NOT build packages (that is `build-agent` /
`packages/agent/platform/linux/scripts/build-server.sh`) and does NOT bring up
the Hub/stack (that is `run-local`). It owns install → enroll → start → verify
→ troubleshoot on the target host.

## Mental model (read first — most bugs come from violating one of these)

The agent sits in the host's **outbound packet path**:

- It intercepts outbound **TCP** via an iptables REDIRECT: `nat OUTPUT -j
  NEXUS_AGENT`, and the `NEXUS_AGENT` chain is `mark 0x4e58 RETURN` /
  `127.0.0.0/8 RETURN` / `-p tcp -j REDIRECT --to-ports 19080`.
- It is **TCP-only**. QUIC / HTTP-3 (UDP 443) is NOT intercepted.
- **Loopback (`127/8`) is RETURN'd** — never intercepted. So traffic a process
  sends to a *local* proxy (`127.0.0.1:<port>`) bypasses the agent entirely.
- Its own upstream forward is stamped **`SO_MARK 0x4e58`** so the chain RETURNs
  it instead of looping it back into 19080 (self-loop avoidance).
- It needs a **device certificate (enroll) before it starts** the chain or the
  listener. No cert ⇒ pending-enrollment ⇒ no 19080, no chain.
- For an inspected domain it MITM-bumps (terminates TLS with a leaf signed by
  the host's device CA), decodes, records, then re-dials the real provider.

Keep these in mind: they explain pending-enrollment, the loopback/proxy bypass,
the QUIC bypass, the SO_MARK self-loop, and the CA-trust failures below.

---

## Happy path

### 0. Dependencies

The deb/rpm/arch package bundles the binary and a postinstall that creates the
`nexus-agent` user, generates the device CA and installs it into the OS trust
store, and **enables (does not start)** the systemd service. Runtime needs:

- `iptables` (either the nft-backed default or `iptables-legacy`) and
  `ip6tables`; `ca-certificates`; glibc ≥ 2.17 (the binary is built portable on
  manylinux2014).
- The audit DB uses go-sqlcipher (CGO) — the shipped binary is CGO-linked; you
  do not compile on the host.

### 1. Install (pick the distro family)

| Family | Package | Install |
|---|---|---|
| Ubuntu / Mint / Debian | `nexus-agent_<ver>_amd64.deb` | `sudo apt install -y ./nexus-agent_<ver>_amd64.deb` |
| Fedora / RHEL / Rocky / Alma / CentOS | `nexus-agent-<ver>-1.x86_64.rpm` | `sudo dnf install -y ./nexus-agent-<ver>-1.x86_64.rpm` |
| Arch / Manjaro | `nexus-agent-<ver>-1-x86_64.pkg.tar.zst` | `sudo pacman -U ./nexus-agent-<ver>-1-x86_64.pkg.tar.zst` |

```bash
nexus-agent version    # version=<ver> commit=<rev> built=<utc> — confirm commit/built are stamped, not "unknown"
```

### 2. Point the agent at the Hub

```bash
sudo sed -i \
  's|^hubURL: .*|hubURL: "ws://<hub-host>:3060/ws"|; s|^hubHTTPURL: .*|hubHTTPURL: "http://<hub-host>:3060"|' \
  /etc/nexus-agent/agent.yaml
```

`<hub-host>` is an IP or domain reachable from the target. **A DHCP Hub IP
drifts** — if the Hub moves, the agent logs `no route to host` on audit upload;
prefer a static IP or a domain.

### 3. Enroll — MANDATORY, and the #1 thing people skip

`apt install` only **enables** the unit; it does NOT enroll. `systemctl start`
without a device cert leaves the daemon in **pending-enrollment mode**
(journal: `agent starting in pending-enrollment mode (no device cert on disk)`
/ `waiting for enrollment via menu-bar UI`). In that mode there is **no 19080
and no chain** by design — without a cert it cannot MITM.

```bash
# Mint a single-use token on the Hub side (admin API), then on the target:
sudo systemctl stop nexus-agent          # if it was started pre-enroll
sudo nexus-agent enroll --hub-url http://<hub-host>:3060 --token <token> \
  --config /etc/nexus-agent/agent.yaml
# MUST print: Enrolled successfully. Device ID: agent-xxxxxxxx
sudo chown -R nexus-agent:nexus-agent /var/lib/nexus-agent   # enroll wrote certs as root
sudo systemctl start nexus-agent
```

### 4. Verify (do not declare success without these)

```bash
sudo ss -ltnp | grep 19080                       # 127.0.0.1:19080 AND [::1]:19080
sudo iptables -t nat -S NEXUS_AGENT | head        # mark RETURN / loopback RETURN / REDIRECT 19080
sudo journalctl -u nexus-agent -n 30 --no-pager | grep -iE \
  "connected to Hub|iptables chain installed|transparent proxy listening|interception not available"
# End-to-end (the only real proof): hit an interception domain, then check the Hub DB
curl -sS -m15 -o /dev/null -w '%{http_code}\n' https://api.openai.com/v1/models -H 'authorization: Bearer sk-x'
#   -> a traffic_event with source='agent', target_host='api.openai.com' should appear
```

---

## Troubleshooting matrix

Grouped by layer. Each row is **symptom → root cause → fix**.

### A. Service / enrollment

| Symptom | Cause | Fix |
|---|---|---|
| `active` but no 19080, no chain; journal `pending-enrollment` / `waiting for enrollment via menu-bar UI` | Enroll was skipped — daemon has no device cert | Run the **§3 enroll** step, then restart. The daemon exits after enroll and systemd restarts it into the full stack. |
| `mkdir /var/run/nexus-agent: permission denied` (self-intercept guard warn) | Unit lacks a runtime dir for the non-root user | Add `RuntimeDirectory=nexus-agent` to the unit / a drop-in (also needed for the legacy-iptables lock below). Secondary — SO_MARK still guards the self-loop. |

### B. iptables / interception chain (the hard ones — kernel/backend mismatches)

| Symptom | Cause | Fix |
|---|---|---|
| `platform interception not available: ... iptables -t nat -S NEXUS_AGENT: exit status 1 (stderr="iptables: Incompatible with this kernel.")`, often with `Warning: iptables-legacy tables present` | New kernels (6.x) + an older `iptables` 1.8.x: the **iptables-nft compat layer fails on the nat table** when a stray `iptable_nat` (legacy) module is loaded (Docker, ufw, or a prior `iptables-legacy` call). Native `nft` works; the `iptables` CLI does not. | Point the agent at **iptables-legacy** + give it a writable lock + load the nat modules (full recipe below). Verify `iptables-legacy -t nat -S` is stable first. |
| `exit status 4 (stderr="Fatal: can't open lock file /run/xtables.lock: Permission denied")` | iptables-legacy uses `/run/xtables.lock` (mode 0600 root); the `nexus-agent` user can't open it (nft doesn't use this lock) | `Environment=XTABLES_LOCKFILE=/run/nexus-agent/xtables.lock` + `RuntimeDirectory=nexus-agent` in a drop-in. |
| `ip6tables ... exit status 3` (IPv4 chain installs, IPv6 fails) | `ip6table_nat` legacy module not loaded; `ProtectKernelModules=true` stops the daemon from auto-loading it | Pre-load via `/etc/modules-load.d/nexus-agent-nat.conf` (`iptable_nat` + `ip6table_nat`). |
| `chain '<n>' in table 'nat' is incompatible, use 'nft' tool` (chain-level, on Docker/libvirt/k8s hosts whose nat already holds nft rules) | The nft shim can't enumerate a not-yet-created chain; the agent treats this as "absent → install" since 1.0.x | Ensure the agent has the `chainAbsentErr` fix (≥ the version that ships it). If still failing, this is a different error — re-read the exact stderr. |
| One request → **502 after ~19 s** and **hundreds of `source=agent` rows** | SO_MARK self-loop: the MITM upstream wasn't marked, so the agent re-intercepts its own forward | Upgrade to a version with the `tlsbump` SO_MARK fix (the upstream dialer consults the global dial-control hook). |
| Host-wide **plain-HTTP** egress stalls ~5 s while the agent runs | PeekSNI read a non-TLS first packet as a TLS record length and blocked | Upgrade to a version with the PeekSNI non-TLS guard (returns early on a non-`0x16` first byte). |

**The iptables-legacy recipe** (kernel-6.x / Docker-host where nft is broken):

```bash
# 1. confirm legacy works and nft doesn't (run a few times — nft failure can be flaky)
for i in 1 2 3; do sudo iptables -t nat -S NEXUS_AGENT 2>&1 | tail -1; done           # nft -> Incompatible
for i in 1 2 3; do sudo iptables-legacy -t nat -S NEXUS_AGENT 2>&1 | tail -1; done    # legacy -> "No chain" (good)
# 2. legacy binaries the agent will use (PATH override, system default untouched -> Docker unaffected)
sudo mkdir -p /usr/lib/nexus-agent/legacy-bin
for b in iptables ip6tables iptables-restore ip6tables-restore iptables-save ip6tables-save; do
  sudo ln -sf "/usr/sbin/${b/iptables/iptables-legacy}" "/usr/lib/nexus-agent/legacy-bin/$b" 2>/dev/null
done
sudo ln -sf /usr/sbin/iptables-legacy          /usr/lib/nexus-agent/legacy-bin/iptables
sudo ln -sf /usr/sbin/ip6tables-legacy         /usr/lib/nexus-agent/legacy-bin/ip6tables
sudo ln -sf /usr/sbin/iptables-legacy-restore  /usr/lib/nexus-agent/legacy-bin/iptables-restore
sudo ln -sf /usr/sbin/ip6tables-legacy-restore /usr/lib/nexus-agent/legacy-bin/ip6tables-restore
# 3. systemd drop-in: PATH -> legacy + writable lock + runtime dir
sudo mkdir -p /etc/systemd/system/nexus-agent.service.d
sudo tee /etc/systemd/system/nexus-agent.service.d/10-iptables-legacy.conf >/dev/null <<'EOF'
[Service]
Environment=PATH=/usr/lib/nexus-agent/legacy-bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=XTABLES_LOCKFILE=/run/nexus-agent/xtables.lock
RuntimeDirectory=nexus-agent
RuntimeDirectoryMode=0750
EOF
# 4. ensure the legacy nat modules load at boot (ProtectKernelModules blocks the daemon from loading them)
printf 'iptable_nat\nip6table_nat\n' | sudo tee /etc/modules-load.d/nexus-agent-nat.conf >/dev/null
sudo modprobe iptable_nat ip6table_nat
sudo systemctl daemon-reload && sudo systemctl restart nexus-agent
# verify: chain in the legacy table now
sudo iptables-legacy -t nat -S NEXUS_AGENT
```

Docker on these hosts uses the nft nat table; the PATH override is agent-only,
so Docker is untouched — confirm with `sudo docker info` after.

### C. CA / TLS trust

| Symptom | Cause | Fix |
|---|---|---|
| `curl: (77) error setting certificate file: /var/lib/nexus-agent/device-ca.pem` | A login shell sourced `/etc/profile.d/nexus-agent-ca.sh`, which sets `SSL_CERT_FILE` to the device CA (for Node/Python); that path is root-only | `unset SSL_CERT_FILE` (curl then uses the OS store, which already trusts the device CA), or point it at `/etc/ssl/certs/ca-certificates.crt`. |
| Browser shows `NET::ERR_CERT_AUTHORITY_INVALID` on intercepted HTTPS | Browsers use their **own** trust store (Chrome NSS `~/.pki/nssdb`, Firefox per-profile), not the OS store the install populated | Import `/usr/local/share/ca-certificates/nexus-agent.crt`: Chrome `certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "Nexus Agent CA" -i ...`; Firefox `about:config security.enterprise_roots.enabled=true` or import under Authorities. |

### D. Reaching the provider (censored / GFW networks)

Intercepted call → 502 / `connection reset by peer` / timeout means the host
can't reach the real provider. **Isolate before fixing** (stop the agent, test
direct):

```bash
sudo systemctl stop nexus-agent
getent hosts api.openai.com                                   # poisoned? (fake IP e.g. 108.160.x / face:b00c)
timeout 6 bash -c 'cat </dev/null >/dev/tcp/162.159.140.245/443' && echo "real IP reachable"
# TLS reset test: a curl to the real IP that RSTs mid-handshake = SNI blocking, not DNS
sudo systemctl start nexus-agent
```

| Layer | Symptom | Fix |
|---|---|---|
| DNS poisoned | resolves to a fake IP | DoT: `/etc/systemd/resolved.conf.d/` with `DNSOverTLS=yes` + `DNS=1.1.1.1#cloudflare-dns.com 8.8.8.8#dns.google` + `Domains=~.`; `systemctl restart systemd-resolved`. **Caveat:** the agent intercepts 853 too — if DoT-through-the-agent hangs, give the host a clean resolver path or use the egress proxy instead. |
| TLS SNI reset | TCP connects, RST mid-handshake | DNS fix won't help — the provider is SNI-blocked. Route the agent's upstream through a working proxy ↓. |

**Egress proxy** (when a local circumvention client — xray/v2rayN SOCKS — is the
only working path out): set in `agent.yaml`

```yaml
upstreamProxy: "socks5://127.0.0.1:10808"   # also socks5h:// or http://; empty/unset = direct (default)
```

The agent still intercepts + monitors; only the final hop to the provider goes
via the proxy. Confirm `egress proxy: MITM upstream routed via proxy` in the
journal.

### E. Browser monitoring specifics

| Symptom | Cause | Fix |
|---|---|---|
| Browser AI use works but **no record** | The browser uses a **system/local proxy** (xray on `127.0.0.1`) → loopback → the agent doesn't intercept it | Set the browser (or the AI domains) to **direct / no proxy** so the agent catches them; the agent then forwards via `upstreamProxy`. For "proxy everything else, direct for AI", add the AI domains to the proxy's ignore-hosts. |
| Browser AI use, still no record after going direct | Browser uses **QUIC / HTTP-3** (UDP 443); the TCP-only agent doesn't see it | Disable HTTP/3 (Firefox `about:config network.http.http3.enable=false`) **or** block UDP 443 to force TCP fallback: `sudo iptables -A OUTPUT -p udp --dport 443 -j REJECT --reject-with icmp-port-unreachable` (+ `ip6tables`). **Fully quit and reopen** the browser to drop cached QUIC connections. |
| "`chatgpt.com` is not in the device's `aiDomains`" | `aiDomains` in the device-config view is **provider-derived** (API hosts of enabled Providers), NOT the interception list | It is still monitored. The agent intercepts the **interception_domains catalog** (manage in CP → Interception Domains), which includes `chatgpt.com` / `claude.ai`. Verify with a live request: the journal shows `handing flow off to BumpConnection` for the domain. |

### F. Hub connectivity

| Symptom | Cause | Fix |
|---|---|---|
| `agent-audit upload ... no route to host` / `config pull failed: dial tcp <ip>: connect` | Hub address moved (DHCP drift) or unreachable | Update `agent.yaml` hubURL/hubHTTPURL to the Hub's current address; prefer a static IP / domain. The agent stays online over WS but queues audits locally until reachable. |

---

## Methodology (the meta-lesson that made the above tractable)

1. **Read the real error first.** `journalctl -u nexus-agent -f`, the exact
   stderr, the iptables **exit code** (1 = incompatible/absent, 3 = no IPv6
   nat, 4 = lock), `ss -ltnp | grep 19080`, the chain dump. Most fixes are
   determined by one precise line.
2. **Isolate the layer.** Stop the agent and retest to separate
   **agent-vs-network**. For "can't reach provider", walk **DNS → TCP-connect →
   TLS-handshake → routing** and find which one fails (poison vs SNI-reset are
   different fixes). For iptables, test **nft vs legacy** backend directly.
3. **Reproduce under the same constraints before editing the unit.** Use
   `systemd-run -p User=nexus-agent -p AmbientCapabilities=CAP_NET_ADMIN -p
   ProtectKernelModules=true /usr/sbin/iptables -t nat -L` to find *which*
   sandbox directive or module state breaks the command — don't guess.
4. **Never break the host.** The agent is in the egress path; loopback is
   exempt; it fails open. After every change, confirm unrelated traffic still
   works (e.g. `getent hosts github.com`, `docker info`).
5. **Persist fixes across reboot** and say which: kernel modules →
   `modules-load.d`; iptables backend → systemd drop-in; DoT → resolved
   drop-in; UDP-443 block → `iptables-persistent` or a unit.
6. **Verify end-to-end.** The only real "done" is a request to an interception
   domain producing a `traffic_event` (`source='agent'`) in the Hub DB / UI —
   not just `active` or a listening 19080.

## References

- `docs/operators/ops/runbooks/agent-linux-lan-test.md` — LAN install/test runbook
- `docs/developers/architecture/services/agent/agent-linux-platform-architecture.md` — chain, reconciler, SO_MARK, `/proc` attribution
- `packages/agent/cmd/agent/cmd_enroll.go` — enroll command
- `packages/agent/internal/platform/linux/` — listener, reconciler, iptables wrappers, health
- `packages/agent/platform/linux/scripts/build-server.sh` — build the deb/rpm/arch packages (run via `build-agent`)
- `packages/shared/transport/tlsbump/` — MITM upstream, SO_MARK dial control, egress proxy (`upstreamProxy`)
