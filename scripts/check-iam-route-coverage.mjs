#!/usr/bin/env node
/**
 * IAM route-coverage check (e2e release-gate invariant, static arm).
 *
 * Every admin route must enforce authorization. The Control Plane registers
 * admin routes by passing an `iamMW` closure into each `RegisterXRoutes(g, iamMW)`
 * function; a route is protected when its registration call includes
 * `iamMW(iam.ResourceX.Action(iam.VerbY))`. This check scans the admin-handler
 * tree and FAILS if a route registration in an iamMW-bearing file omits the
 * middleware — the static counterpart of the runtime "every admin route enforces
 * IAM" invariant (which cannot be enumerated black-box: there is no route-registry
 * endpoint and routes are wired via per-handler closures).
 *
 * Scope: files under packages/control-plane/internal that already use `iamMW`
 * (the admin registrars). A route line there must carry `iamMW(` OR an inline
 * `// iam-exempt: <reason>` marker for an intentionally-unauthorized route
 * (self-service /me endpoints, public discovery proxied through the group, etc.).
 *
 * Behaviour:
 *   - Route registration without iamMW and without an exempt marker -> FAIL (exit 1).
 *   - Otherwise -> OK (exit 0).
 *
 * Why static, not an L5 scenario: it catches "a new admin route forgot iamMW"
 * at the source, before the route ever ships — the drift the runtime gate can
 * only observe one route at a time.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIR = 'packages/control-plane/internal';
const ROUTE_RE = /\.(GET|POST|PUT|DELETE|PATCH)\(/;
const IAM_RE = /iamMW(Device)?\(/;
const EXEMPT_RE = /iam-exempt:/;
// A handful of files are not admin route registrars even though `iamMW`
// appears (the middleware definition itself, the closure factory).
const FILE_SKIP = new Set([
  'packages/control-plane/internal/platform/middleware/iamauth.go',
  'packages/control-plane/internal/handler/admin_routes.go',
]);

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith('.go') && !entry.endsWith('_test.go')) {
      out.push(full);
    }
  }
}

function main() {
  const files = [];
  walk(join(ROOT, SCAN_DIR), files);

  const violations = [];
  let scannedFiles = 0;
  let routeLines = 0;

  for (const full of files) {
    const rel = full.slice(ROOT.length + 1);
    if (FILE_SKIP.has(rel)) continue;
    const src = readFileSync(full, 'utf-8');
    // Only admin registrars (files that wire iamMW) are in scope.
    if (!IAM_RE.test(src)) continue;
    scannedFiles++;

    const lines = src.split('\n');

    // Pass 1: subgroups created with group-level iamMW — their routes inherit
    // the middleware, e.g. `rp := g.Group("/rule-packs", iamMW(...))`.
    const protectedGroups = new Set();
    const GROUP_RE = /(\w+)\s*:?=\s*[\w.]+\.Group\(([^\n]*)/;
    for (const line of lines) {
      const gm = GROUP_RE.exec(line);
      if (gm && IAM_RE.test(gm[2])) protectedGroups.add(gm[1]);
    }

    // Accumulate a route's full registration statement (it may wrap across
    // lines, with iamMW on a continuation line) by balancing parentheses from
    // the `.METHOD(` line until the call closes. This captures multi-line
    // registrations without letting one route borrow the next route's iamMW.
    const statementText = (start) => {
      let depth = 0, started = false, text = '';
      for (let j = start; j < Math.min(start + 6, lines.length); j++) {
        text += lines[j] + '\n';
        for (const ch of lines[j]) {
          if (ch === '(') { depth++; started = true; } else if (ch === ')') depth--;
        }
        if (started && depth <= 0) break;
      }
      return text;
    };

    // Pass 2: every route registration must be protected route-level, via a
    // group-level-iamMW group, or carry an explicit `// iam-exempt:` marker.
    const ROUTE_RECV_RE = /(\w+)\.(GET|POST|PUT|DELETE|PATCH)\(/;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();
      if (trimmed.startsWith('//')) continue; // commented-out code
      const rm = ROUTE_RECV_RE.exec(line);
      if (!rm) continue;
      routeLines++;
      const stmt = statementText(i);
      if (IAM_RE.test(stmt)) continue; // route-level middleware (same or wrapped line)
      if (protectedGroups.has(rm[1])) continue; // group-level middleware
      if (EXEMPT_RE.test(stmt)) continue; // explicit exemption
      violations.push(`${rel}:${i + 1}: ${trimmed.slice(0, 100)}`);
    }
  }

  if (violations.length > 0) {
    console.error(
      `[check:iam-routes] FAILED: ${violations.length} admin route registration(s) without iamMW (and no // iam-exempt: marker):`,
    );
    for (const v of violations) console.error('  - ' + v);
    console.error(
      '  Fix: add iamMW(iam.ResourceX.Action(iam.VerbY)) to the route, or — for an intentionally\n' +
        '  unauthorized route (self-service /me, public discovery) — annotate it with an inline\n' +
        '  `// iam-exempt: <reason>` comment.',
    );
    process.exit(1);
  }

  console.log(
    `[check:iam-routes] OK -- ${routeLines} admin route registration(s) across ${scannedFiles} registrar file(s) all enforce iamMW (or are explicitly iam-exempt).`,
  );
}

main();
