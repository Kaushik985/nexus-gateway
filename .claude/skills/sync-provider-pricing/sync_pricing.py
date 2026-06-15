#!/usr/bin/env python3
"""Deterministic reconciler for sync-provider-pricing.

The LLM's only job is to WebFetch a provider's official pricing page and emit a
normalized desired-state JSON (schema below). THIS script does every mechanical
step deterministically — diff, edit the template JSON, edit the Model fixture,
and emit transactional prod UPDATE SQL — so the reconcile never drifts.

Desired-state JSON (one file per provider, produced by the LLM from the official page):
{
  "provider": "anthropic",
  "source_url": "https://platform.claude.com/docs/en/about-claude/pricing",
  "fetched": "2026-06-03",
  "models": [
    {
      "code": "claude-opus-4-8",          # REQUIRED, matches Model.code
      "input": 5.0,                         # $/MTok base input  (REQUIRED for chat)
      "output": 25.0,                       # $/MTok output
      "cache_write": 6.25,                  # $/MTok standard (short) cache write; 0 if none
      "cache_read": 0.5,                    # $/MTok cache hit/read; null for non-chat
      "status": "active",                   # active | deprecated | disabled
      "replaced_by": null,                  # successor code if deprecated/retired
      "deprecation_date": null              # ISO date if deprecated
    }
  ]
}
Only keys present are compared/applied; omit a key to leave that field untouched.

Subcommands:
  diff       <desired.json>              show drift: desired vs template JSON vs fixture
  apply      <desired.json>              edit template JSON (+ index.json modelCount) and
                                         tools/db-migrate/seed/fixtures/Model.json in place
                                         (input/output/status)
  prod-sql   <desired.json> [--out f]    emit BEGIN/UPDATE.../COMMIT for the prod Model table

Paths default to repo-relative; override with --repo. Money compared at 1e-9 tolerance.
"""
import argparse
import json
import os
import sys
from decimal import Decimal

TEMPLATE_FIELDS = {  # desired-key -> template-JSON key
    "input": "inputPricePerMillion",
    "output": "outputPricePerMillion",
    "cache_write": "cachedInputWritePricePerMillion",
    "cache_read": "cachedInputReadPricePerMillion",
}
# fixture + prod carry all 4 money fields.
FIXTURE_MONEY = {
    "input": "inputPricePerMillion",
    "output": "outputPricePerMillion",
    "cache_write": "cachedInputWritePricePerMillion",
    "cache_read": "cachedInputReadPricePerMillion",
}
PROD_FIELDS = {
    "input": "inputPricePerMillion",
    "output": "outputPricePerMillion",
    "cache_write": "cachedInputWritePricePerMillion",
    "cache_read": "cachedInputReadPricePerMillion",
}


def repo_paths(repo):
    return {
        "template_dir": os.path.join(repo, "packages/control-plane-ui/public/provider-templates"),
        "dist_dir": os.path.join(repo, "packages/control-plane-ui/dist/provider-templates"),
        "fixture": os.path.join(repo, "tools/db-migrate/seed/fixtures/Model.json"),
    }


def load_desired(path):
    with open(path) as f:
        d = json.load(f)
    if "provider" not in d or "models" not in d:
        sys.exit("desired JSON must have 'provider' and 'models'")
    by_code = {}
    for m in d["models"]:
        if "code" not in m:
            sys.exit(f"model entry missing 'code': {m}")
        by_code[m["code"]] = m
    return d["provider"], by_code, d


def money_eq(a, b):
    if a is None or b is None:
        return a is None and b is None
    return abs(Decimal(str(a)) - Decimal(str(b))) < Decimal("1e-9")


def fmt(v):
    return "·" if v is None else f"{Decimal(str(v)):g}"


def load_fixture(fixture_path):
    """Load Model.json fixture; return (rows_list, by_code_dict).
    by_code maps code -> row object (same reference as rows_list entry)."""
    if not os.path.exists(fixture_path):
        return [], {}
    with open(fixture_path) as f:
        rows = json.load(f)
    by_code = {r["code"]: r for r in rows}
    return rows, by_code


def save_fixture(fixture_path, rows):
    """Write Model.json with 2-space indent + trailing newline (matches fixture format)."""
    with open(fixture_path, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2, ensure_ascii=False)
        f.write("\n")


def num_literal(v):
    # Emit a decimal literal suitable for prod UPDATE SQL (30-dp style, trailing zeros stripped).
    return f"{Decimal(str(v)):.30f}".rstrip("0").rstrip(".") if v is not None else "NULL"


# ─── commands ─────────────────────────────────────────────────────────────────
def cmd_diff(args):
    provider, desired, meta = load_desired(args.desired)
    p = repo_paths(args.repo)
    tpath = os.path.join(p["template_dir"], f"{provider}.json")
    tpl = json.load(open(tpath)) if os.path.exists(tpath) else {"models": []}
    tpl_by = {m["code"]: m for m in tpl.get("models", [])}
    _, fixture_by = load_fixture(p["fixture"])
    # Only show fixture rows for codes present in desired.
    fixture_matched = {code: fixture_by[code] for code in desired if code in fixture_by}

    # Approval-ready header: every change must be confirmable against this source.
    print(f"=== APPROVAL DIFF: {provider} ===")
    print(f"  source : {meta.get('source_url', '?')}")
    print(f"  fetched: {meta.get('fetched', '?')}")
    print(f"  scope  : desired={len(desired)} | template={len(tpl_by)} | fixture-rows-matched={len(fixture_matched)}")
    print(f"  ACTION : present each ↓ change WITH the source link above and get explicit user approval BEFORE apply/prod-sql.")
    drift = 0
    for code, want in desired.items():
        t = tpl_by.get(code)
        marks = []
        for k, tk in TEMPLATE_FIELDS.items():
            if k in want and (t is None or not money_eq(want[k], t.get(tk))):
                marks.append(f"{k}: {fmt(None if t is None else t.get(tk))}→{fmt(want[k])}")
        if "status" in want and t is not None and want["status"] != t.get("status", "active"):
            marks.append(f"status: {t.get('status','active')}→{want['status']}")
        if t is None:
            marks.append("NOT in template (add?)")
        s = fixture_by.get(code)
        for k, fk in FIXTURE_MONEY.items():
            if k in want and s is not None and not money_eq(want[k], s.get(fk)):
                marks.append(f"fixture.{k}: {fmt(s.get(fk))}→{fmt(want[k])}")
        if marks:
            drift += 1
            print(f"  {code}: " + " | ".join(marks))
        else:
            print(f"  {code}: ok")
    extra = set(tpl_by) - set(desired)
    if extra:
        print(f"  -- in template but NOT on official page (deprecate?): {sorted(extra)}")
    print(f"=== {drift} model(s) drifted ===")
    return 0


def cmd_apply(args):
    provider, desired, _ = load_desired(args.desired)
    p = repo_paths(args.repo)
    # 1) template JSON (+ dist mirror + index.json modelCount)
    for d in (p["template_dir"], p["dist_dir"]):
        tpath = os.path.join(d, f"{provider}.json")
        if not os.path.exists(tpath):
            continue
        tpl = json.load(open(tpath))
        changed = 0
        by = {m["code"]: m for m in tpl.get("models", [])}
        for code, want in desired.items():
            m = by.get(code)
            if m is None:
                continue
            for k, tk in TEMPLATE_FIELDS.items():
                if k in want and not money_eq(want[k], m.get(tk)):
                    m[tk] = want[k]; changed += 1
            if "status" in want and want["status"] != m.get("status", "active"):
                m["status"] = want["status"]; changed += 1
        with open(tpath, "w") as f:
            json.dump(tpl, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"  template {os.path.relpath(tpath, args.repo)}: {changed} field(s) updated")
    _bump_index(p, provider, desired, args.repo)
    # 2) Model.json fixture — update inputPricePerMillion / outputPricePerMillion /
    #    cachedInputReadPricePerMillion / cachedInputWritePricePerMillion / status in place.
    _apply_fixture(p["fixture"], desired, args.repo)
    return 0


def _bump_index(p, provider, desired, repo):
    for d in (p["template_dir"], p["dist_dir"]):
        ipath = os.path.join(d, "index.json")
        if not os.path.exists(ipath):
            continue
        idx = json.load(open(ipath))
        tpath = os.path.join(d, f"{provider}.json")
        cnt = len(json.load(open(tpath)).get("models", [])) if os.path.exists(tpath) else None
        for t in idx.get("templates", []):
            if t.get("name") == provider and cnt is not None and t.get("modelCount") != cnt:
                t["modelCount"] = cnt
        with open(ipath, "w") as f:
            json.dump(idx, f, indent=2, ensure_ascii=False)
            f.write("\n")


def _apply_fixture(fixture_path, desired, repo):
    """Update Model.json fixture rows for the models in desired.
    Matches by code. Writes back with 2-space indent + trailing newline."""
    rows, by_code = load_fixture(fixture_path)
    if not rows:
        print(f"  fixture {os.path.relpath(fixture_path, repo)}: file not found or empty — skipped")
        return
    changed = 0
    for code, want in desired.items():
        row = by_code.get(code)
        if row is None:
            continue
        for k, fk in FIXTURE_MONEY.items():
            if k in want:
                if not money_eq(want[k], row.get(fk)):
                    row[fk] = want[k]
                    changed += 1
        if "status" in want and row.get("status") != want["status"]:
            row["status"] = want["status"]
            changed += 1
    if changed:
        save_fixture(fixture_path, rows)
    print(f"  fixture {os.path.relpath(fixture_path, repo)}: {changed} field(s) updated")


def cmd_prod_sql(args):
    provider, desired, meta = load_desired(args.desired)
    out = ["BEGIN;",
           f"-- sync-provider-pricing: {provider} from {meta.get('source_url','?')} ({meta.get('fetched','?')})"]
    for code, want in desired.items():
        sets = []
        for k, pf in PROD_FIELDS.items():
            if k in want:
                v = "NULL" if want[k] is None else num_literal(want[k])
                sets.append(f'"{pf}" = {v}')
        if "status" in want:
            sets.append(f"\"status\" = '{want['status']}'")
            sets.append(f"\"lifecycle\" = '{'deprecated' if want['status']=='deprecated' else 'ga'}'")
        if want.get("replaced_by"):
            sets.append(f"\"replacedBy\" = '{want['replaced_by']}'")
        if want.get("deprecation_date"):
            sets.append(f"\"deprecationDate\" = '{want['deprecation_date']}'")
        if not sets:
            continue
        sets.append('"updatedAt" = now()')
        out.append(
            f'UPDATE public."Model" SET {", ".join(sets)} '
            f"WHERE code = '{code}' "
            f'AND "providerId" = (SELECT id FROM public."Provider" WHERE name = \'{provider}\');')
    out.append("COMMIT;")
    sql = "\n".join(out) + "\n"
    if args.out:
        open(args.out, "w").write(sql)
        print(f"wrote {args.out}")
    else:
        sys.stdout.write(sql)
    return 0


def main():
    ap = argparse.ArgumentParser(description="Deterministic provider-pricing reconciler")
    ap.add_argument("--repo", default=os.getcwd(), help="repo root (default: cwd)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("diff", "apply"):
        s = sub.add_parser(name); s.add_argument("desired")
    s = sub.add_parser("prod-sql"); s.add_argument("desired"); s.add_argument("--out", default="")
    args = ap.parse_args()
    return {"diff": cmd_diff, "apply": cmd_apply, "prod-sql": cmd_prod_sql}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
