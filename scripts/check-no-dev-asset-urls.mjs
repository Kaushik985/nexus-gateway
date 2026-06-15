#!/usr/bin/env node
/**
 * Guard: no local-dev / design-tool asset URLs or tool-name identifiers in
 * committed source. The token / i18n / terminology gates do not cover these,
 * so they get their own check.
 *
 *   R1 (all source) — no `http(s)://localhost|127.0.0.1[:port]/assets/...` and
 *      no `figma.com` asset hosts. Design-tool dev-server URLs render as broken
 *      images in every real environment.
 *   R2 (frontend UI source, tests excluded) — no hardcoded `localhost` /
 *      `127.0.0.1` host in shipped UI source; runtime base URLs come from
 *      config/env, never a hardcoded dev host.
 *   R3 (frontend source) — no design-tool name in identifiers / class names
 *      (`figmaFoo`, `.figma…`, `zeplin…`). Name by intent, not by the tool.
 *
 * Usage:
 *   node scripts/check-no-dev-asset-urls.mjs            # full scan
 *   echo "<paths>" | node scripts/check-no-dev-asset-urls.mjs --files=-
 *
 * Exit 0 = clean, 1 = violations found.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|less|html|vue|svelte)$/;
const TEST_LIKE = /(\.test\.|\.spec\.|\.stories\.|__mocks__|\/test\/|\/tests\/|\/e2e\/|\/__tests__\/)/;
// Frontend UI source roots where a hardcoded localhost host would actually ship.
const FRONTEND_SRC = [
  'packages/control-plane-ui/src',
  'packages/agent/ui/frontend/src',
  'packages/ui-shared/src',
];

// R1: design-tool / local-dev asset server references — broken in prod, anywhere.
const ASSET_URL = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/assets\//i;
const FIGMA_HOST = /https?:\/\/(?:[\w.-]+\.)?figma\.com\//i;
// R2: any hardcoded localhost host in shipped UI source.
const LOCALHOST_URL = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//i;
// R3: design-tool names baked into identifiers / class names.
const TOOL_IDENT = /\bfigma[A-Z]\w*|\.figma[A-Za-z][\w-]*|\bzeplin[A-Za-z]\w*|\.zeplin[\w-]*/;

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '.next', 'out']);

function isFrontendSource(rel) {
  return FRONTEND_SRC.some((r) => rel.startsWith(r + '/'));
}

function walk(dir, acc) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (CODE_EXT.test(name)) acc.push(relative(ROOT, full));
  }
}

function collectFiles() {
  const arg = process.argv.find((a) => a.startsWith('--files='));
  if (arg) {
    const val = arg.slice('--files='.length);
    const raw = val === '-' ? readFileSync(0, 'utf8') : val;
    return raw.split(/\r?\n/).map((s) => s.trim()).filter((p) => p && CODE_EXT.test(p));
  }
  const acc = [];
  walk(join(ROOT, 'packages'), acc);
  return acc;
}

const violations = [];
for (const rel of collectFiles()) {
  let text;
  try { text = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; }
  const frontend = isFrontendSource(rel);
  const isTest = TEST_LIKE.test(rel);
  text.split(/\r?\n/).forEach((line, i) => {
    const ln = i + 1;
    if (ASSET_URL.test(line) || FIGMA_HOST.test(line)) {
      violations.push({ rel, ln, rule: 'R1 dev/design-tool asset URL (broken in prod)', line: line.trim() });
    } else if (frontend && !isTest && LOCALHOST_URL.test(line)) {
      violations.push({ rel, ln, rule: 'R2 hardcoded localhost host in UI source', line: line.trim() });
    }
    if (frontend && TOOL_IDENT.test(line)) {
      violations.push({ rel, ln, rule: 'R3 design-tool name in identifier/class', line: line.trim() });
    }
  });
}

if (violations.length === 0) {
  console.log('dev-asset-url guard — clean (no localhost/figma asset URLs or tool-name identifiers)');
  process.exit(0);
}

console.error(`✗ dev-asset-url guard: ${violations.length} violation(s)\n`);
for (const v of violations) {
  console.error(`  ${v.rel}:${v.ln}  [${v.rule}]`);
  console.error(`      ${v.line.slice(0, 160)}`);
}
console.error(`
Fix:
  • Export the asset into the repo (public/icons/…) or inline the SVG, and
    reference a local/build path — never a design-tool dev-server (localhost:38xx) URL.
  • UI base URLs come from config/env, not a hardcoded http://localhost host.
  • Name variants/classes by intent (e.g. "boxed"), not by the tool they came from.`);
process.exit(1);
