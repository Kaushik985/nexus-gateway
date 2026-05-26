#!/usr/bin/env python3
"""Deterministic OSS leak scanner.

Emits candidate secret / PII / infra leaks from the repo so an LLM can triage
them. The detection is 100% deterministic (regex + entropy + allowlist) — the
LLM never does the raw scanning, it only adjudicates this script's output, so
an LLM "drifting" cannot cause a missed leak. Re-run after every fix.

Scope: by default every git-tracked text file. Detectors are layered by
category with a severity, and each finding is tagged `likely_intentional` when
it sits in a test fixture or matches a known example value, so the triage step
can focus on the real ones first.

Usage:
  python3 scan.py                 # human summary to stdout, exit 1 if findings
  python3 scan.py --json          # machine-readable JSON of all findings
  python3 scan.py --severity high # only CRITICAL/HIGH
  python3 scan.py --include-archive   # also scan docs/_archive (default: skip)
  python3 scan.py --allow FILE    # extra allowlist file (one literal/regex per line)
  python3 scan.py --paths a b     # scan only these paths instead of git ls-files

Allowlist: built-in safe values below + an optional repo-root `.secret-scan-allow`
file (one entry per line; `re:` prefix = regex, otherwise literal substring).
A line containing `secret-scan:allow` is always ignored (inline waiver).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import sys

# ---------------------------------------------------------------------------
# Allowlist — values that are safe by construction. Extend via .secret-scan-allow.
# ---------------------------------------------------------------------------
SAFE_LITERALS = {
    # canonical placeholder / example tokens
    "AKIAIOSFODNN7EXAMPLE",            # AWS docs example access key
    "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "0000000000000000000000000000000000000000",
    "00000000-0000-0000-0000-000000000000",
    "1.1.1.1", "8.8.8.8", "100.64.0.0",   # well-known public DNS / RFC6598 CGN range
    "your-org", "your-domain", "your-prod-host", "apple-id@example.com",
    "maintainers@example.com", "REPLACE_WITH", "YOUR ORG NAME",
}
SAFE_DOMAINS = {
    # our own + reserved example/test TLDs
    "nexus.ai", "example.com", "example.org", "example.net",
    "localhost", "localhost.localdomain",
    # reserved per RFC 2606 / 6761
    "test", "invalid", "local", "localdomain",
    # well-known external services that legitimately appear in code/docs
    "openai.com", "anthropic.com", "claude.ai", "googleapis.com", "google.com",
    "gstatic.com", "github.com", "githubusercontent.com", "npmjs.org",
    "slack.com", "cursor.sh", "amazonaws.com", "microsoft.com", "azure.com",
    "cohere.ai", "cohere.com", "mistral.ai", "deepseek.com", "x.ai", "groq.com",
    "perplexity.ai", "moonshot.cn", "bigmodel.cn", "voyageai.com",
    "huggingface.co", "replicate.com", "together.ai", "together.xyz",
    "fireworks.ai", "minimax.io", "minimaxi.com", "vercel.com", "v0.dev",
    "poe.com", "character.ai", "you.com", "devin.ai", "tabnine.com",
    "codeium.com", "continue.dev", "replit.com", "bolt.new",
    "prometheus.io", "grafana.com", "datadoghq.com", "splunk.com",
    "letsencrypt.org", "schema.org", "w3.org", "ietf.org",
    "golang.org", "go.dev", "pkg.go.dev", "redis.io", "nats.io",
    "postgresql.org", "prisma.io", "docker.com", "docker.io",
    # AI / IDE / consumer-surface hosts the product legitimately intercepts
    # (these appear in interception config + traffic adapters across the repo)
    "chatgpt.com", "character.ai", "c.ai", "chatglm.cn", "cognition.ai",
    "cursor.com", "devin.ai", "githubcopilot.com", "grok.com", "kimi.com",
    "moonshot.ai", "moonshot.cn", "perplexity.ai", "poe.com", "replit.com",
    "replit.dev", "socket.io", "stackblitz.com", "tabnine.com", "v0.dev",
    "you.com", "huggingface.cloud", "m365.cloud", "auth0.com", "okta.com",
    # OSS project's own domains / contacts
    "alphabitcore.com", "nexus-gateway.com",
}
SAFE_DOMAIN_SUFFIXES = (".example", ".example.com", ".test", ".local", ".invalid",
                        ".nexus.ai", ".internal.example")
PLACEHOLDER_TOKENS = re.compile(
    r"^(REPLACE|CHANGEME|CHANGE_ME|YOUR[_-]?|<.*>|\$\{?[A-Za-z_]|x{6,}|0{6,}|"
    r"example|placeholder|dummy|fake|test|sample|redacted|todo|none|null)",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Path scoping
# ---------------------------------------------------------------------------
EXCLUDE_DIR_PARTS = {".git", "node_modules", "vendor", "dist", "build",
                     ".next", "coverage", "__pycache__", ".venv"}
EXCLUDE_SUFFIXES = (".lock", ".sum", ".png", ".jpg", ".jpeg", ".gif", ".webp",
                    ".ico", ".pdf", ".woff", ".woff2", ".ttf", ".otf", ".zip",
                    ".gz", ".tar", ".bin", ".pkg", ".dmg", ".mp4", ".svg")
FIXTURE_HINTS = ("testdata/", "/fixtures/", "_test.", ".test.", "/__tests__/",
                 "/attacks/", "/examples/", "example", "/mocks/", "/mock/")


def shannon_entropy(s: str) -> float:
    if not s:
        return 0.0
    counts = {}
    for ch in s:
        counts[ch] = counts.get(ch, 0) + 1
    n = len(s)
    return -sum((c / n) * math.log2(c / n) for c in counts.values())


# ---------------------------------------------------------------------------
# Detectors — (name, severity, compiled regex, group index for the matched value)
# Severity: CRITICAL > HIGH > MEDIUM > LOW
# ---------------------------------------------------------------------------
RFC1918 = re.compile(
    r"^(10\.|127\.|169\.254\.|0\.|255\.|192\.168\.|"
    r"172\.(1[6-9]|2[0-9]|3[01])\.|"
    r"192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|"      # TEST-NET
    r"22[4-9]\.|23[0-9]\.)"                            # multicast/reserved
)

DETECTORS = [
    ("private-key", "CRITICAL",
     re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----"), 0),
    ("aws-secret-key", "CRITICAL",
     re.compile(r"(?i)aws.{0,20}(secret|sk).{0,20}['\"]([A-Za-z0-9/+=]{40})['\"]"), 2),
    ("gcp-private-key", "CRITICAL",
     re.compile(r"\"private_key\"\s*:\s*\"-----BEGIN"), 0),
    ("db-conn-string", "CRITICAL",
     re.compile(r"(?i)(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)://"
                r"[^\s:/@]+:([^\s:/@]+)@[^\s/]+"), 2),
    ("aws-access-key", "HIGH", re.compile(r"\b(AKIA[0-9A-Z]{16})\b"), 1),
    ("openai-key", "HIGH", re.compile(r"\b(sk-[A-Za-z0-9]{20,})\b"), 1),
    ("github-token", "HIGH", re.compile(r"\b(gh[posru]_[A-Za-z0-9]{30,})\b"), 1),
    ("slack-token", "HIGH", re.compile(r"\b(xox[baprs]-[A-Za-z0-9-]{10,})\b"), 1),
    ("google-api-key", "HIGH", re.compile(r"\b(AIza[0-9A-Za-z_\-]{35})\b"), 1),
    ("stripe-key", "HIGH", re.compile(r"\b((?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,})\b"), 1),
    ("jwt", "HIGH",
     re.compile(r"\b(eyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,})\b"), 1),
    ("password-assign", "HIGH",
     re.compile(r"(?i)(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|"
                r"access[_-]?key|client[_-]?secret)\s*[:=]\s*['\"]([^'\"\s]{6,})['\"]"), 1),
    ("public-ip", "MEDIUM",
     re.compile(r"\b((?:\d{1,3}\.){3}\d{1,3})\b"), 1),
    ("mac-serial", "MEDIUM",
     re.compile(r"(?i)serial[_a-z]*\W{1,4}['\"]?([A-Z0-9]{10,12})['\"]"), 1),
    ("device-uuid", "MEDIUM",
     re.compile(r"(?i)(machineid|deviceid|device[_-]?fingerprint)\W{1,6}"
                r"['\"]?([0-9a-fA-F]{32}|[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})"), 2),
    ("private-email", "MEDIUM",
     re.compile(r"\b([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b"), 1),
    ("ec2-internal-host", "MEDIUM",
     re.compile(r"\b(ip-(?:\d{1,3}-){3}\d{1,3}\.[a-z0-9.\-]*ec2\.internal)\b"), 1),
    # generic high-entropy token — gated by entropy() in code, very noisy otherwise
    ("high-entropy", "LOW",
     re.compile(r"['\"]([A-Za-z0-9+/_\-]{32,})['\"]"), 1),
    # non-allowlisted domain — report-only signal
    ("domain", "LOW",
     re.compile(r"\b((?:[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+"
                r"(?:com|org|net|io|ai|sh|dev|co|cn|xyz|cloud|app))\b"), 1),
]


def domain_is_safe(dom: str) -> bool:
    dom = dom.lower().rstrip(".")
    if dom in SAFE_DOMAINS:
        return True
    if dom.endswith(SAFE_DOMAIN_SUFFIXES):
        return True
    # any registrable suffix match (sub.nexus.ai etc.)
    for safe in SAFE_DOMAINS:
        if dom == safe or dom.endswith("." + safe):
            return True
    return False


def value_is_allowlisted(val: str, extra_literals, extra_regexes) -> bool:
    if val in SAFE_LITERALS or val in extra_literals:
        return True
    if PLACEHOLDER_TOKENS.match(val):
        return True
    for rx in extra_regexes:
        if rx.search(val):
            return True
    return False


def load_allowlist(path):
    lits, rxs = set(), []
    if not path or not os.path.exists(path):
        return lits, rxs
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            line = re.sub(r"\s+#.*$", "", line).strip()  # drop trailing comment
            if not line:
                continue
            if line.startswith("re:"):
                try:
                    rxs.append(re.compile(line[3:]))
                except re.error:
                    pass
            else:
                lits.add(line)
    return lits, rxs


def git_tracked_files():
    try:
        out = subprocess.check_output(["git", "ls-files"], text=True)
        return [f for f in out.splitlines() if f]
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []


def in_scope(path: str, include_archive: bool) -> bool:
    parts = path.split("/")
    if any(p in EXCLUDE_DIR_PARTS for p in parts):
        return False
    if path.endswith(EXCLUDE_SUFFIXES):
        return False
    if not include_archive and "docs/_archive/" in path:
        return False
    return True


def scan_file(path, extra_lits, extra_rxs):
    findings = []
    try:
        with open(path, encoding="utf-8", errors="strict") as fh:
            lines = fh.readlines()
    except (UnicodeDecodeError, OSError):
        return findings  # binary or unreadable
    is_fixture = any(h in path.lower() for h in FIXTURE_HINTS)
    for lineno, line in enumerate(lines, 1):
        if "secret-scan:allow" in line:
            continue
        if len(line) > 4000:
            line = line[:4000]
        for name, sev, rx, gi in DETECTORS:
            for m in rx.finditer(line):
                val = m.group(gi) if gi else m.group(0)
                if not val:
                    continue
                # per-detector gating to cut noise
                if name == "db-conn-string":
                    full = m.group(0)
                    if "@localhost" in full or "@127.0.0.1" in full or "@host" in full:
                        continue  # local-dev / doc-example DSN, not a leak
                    if val.lower() in {"pass", "password", "postgres", "user",
                                       "root", "secret", "changeme", "pwd"}:
                        continue  # trivial placeholder credential
                if name == "password-assign":
                    if val.lower() in {"postgres", "password", "changeme", "secret",
                                       "admin", "root", "test", "example"}:
                        continue  # trivial / well-known placeholder
                if name == "public-ip":
                    if RFC1918.match(val) or val.count(".") != 3:
                        continue
                    octs = val.split(".")
                    if any(not o.isdigit() or int(o) > 255 for o in octs):
                        continue
                    # version strings / RFC section refs / browser UA look like IPs
                    if re.search(r"(?i)version|\bver\b|VER_|driverver|visualstudio|"
                                 r"rfc\s*\d|§\s*\d|chrome/|safari/|firefox/|/\d+\.\d",
                                 line):
                        continue
                if name == "high-entropy":
                    if shannon_entropy(val) < 4.0 or val.isdigit():
                        continue
                if name == "domain":
                    if domain_is_safe(val):
                        continue
                if name == "private-email":
                    dom = val.split("@")[-1]
                    if domain_is_safe(dom):
                        continue
                if value_is_allowlisted(val, extra_lits, extra_rxs):
                    continue
                findings.append({
                    "category": name,
                    "severity": sev,
                    "file": path,
                    "line": lineno,
                    "match": _redact(val),
                    "likely_intentional": is_fixture,
                    "snippet": line.strip()[:200],
                })
    return findings


def _redact(val: str) -> str:
    if len(val) <= 12:
        return val
    return val[:4] + "…" + val[-4:]


SEV_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--severity", choices=["critical", "high", "medium", "low"],
                    default="low")
    ap.add_argument("--include-archive", action="store_true")
    ap.add_argument("--allow", default=".secret-scan-allow")
    ap.add_argument("--paths", nargs="*")
    args = ap.parse_args()

    extra_lits, extra_rxs = load_allowlist(args.allow)
    files = args.paths if args.paths else git_tracked_files()
    files = [f for f in files if in_scope(f, args.include_archive) and os.path.isfile(f)]

    minsev = SEV_ORDER[args.severity.upper()]
    findings = []
    for f in files:
        for fnd in scan_file(f, extra_lits, extra_rxs):
            if SEV_ORDER[fnd["severity"]] <= minsev:
                findings.append(fnd)
    findings.sort(key=lambda x: (SEV_ORDER[x["severity"]], x["likely_intentional"],
                                 x["file"], x["line"]))

    if args.json:
        print(json.dumps({"scanned": len(files), "findings": findings}, indent=2))
        sys.exit(1 if findings else 0)

    print(f"OSS leak scan — {len(files)} files scanned, {len(findings)} candidate(s)\n")
    by_sev = {}
    for fnd in findings:
        by_sev.setdefault(fnd["severity"], []).append(fnd)
    for sev in ("CRITICAL", "HIGH", "MEDIUM", "LOW"):
        rows = by_sev.get(sev, [])
        if not rows:
            continue
        print(f"== {sev} ({len(rows)}) ==")
        for r in rows:
            flag = " [likely-fixture]" if r["likely_intentional"] else ""
            print(f"  {r['file']}:{r['line']}  [{r['category']}] {r['match']}{flag}")
            print(f"      {r['snippet']}")
        print()
    if findings:
        print("Triage each above: TRUE-LEAK (fix) / FALSE-POSITIVE (add to "
              ".secret-scan-allow with reason) / NEEDS-HUMAN. Re-run until clean.")
    sys.exit(1 if findings else 0)


if __name__ == "__main__":
    main()
