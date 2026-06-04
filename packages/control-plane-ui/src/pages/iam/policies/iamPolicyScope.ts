import type { ActionCatalogResponse } from '@/api/services';
import type { StatementEntry } from '../_shared/iam-policy-document';

// inferStatementMode looks at the parsed actions of a statement and
// decides which UI mode best represents them. The Statement card dispatches to:
//
//   scoped   — all actions are admin:<X>.* or admin:<X>.<verb> for one
//              resource X → render AWS-style ScopedActionsPicker
//              filtered to that resource's verb set.
//   wildcard — actions includes admin:* or * → user has granted
//              everything; render a compact summary with the catalog
//              browser as the only escape hatch.
//   mixed    — actions span multiple resources or include non-admin
//              identifiers (gateway:invoke:*, ai-guard:invoke,
//              vendor strings like s3:GetObject pasted from AWS) →
//              fall back to the multi-resource chip input + browser.
//   empty    — no actions yet. The dropdown shows "Choose a resource"
//              and an explicit override of `intendedScope` lets the
//              user open a scoped picker for an empty statement.
export type StatementMode =
  | { kind: 'empty'; intended?: string }
  | { kind: 'scoped'; resource: string }
  | { kind: 'wildcard' }
  | { kind: 'mixed' };

export function inferStatementMode(actions: string, intended?: string): StatementMode {
  const parsed = actions.split('\n').map((s) => s.trim()).filter(Boolean);
  if (parsed.length === 0) return { kind: 'empty', intended };
  if (parsed.some((a) => a === 'admin:*' || a === '*')) return { kind: 'wildcard' };
  const resources = new Set<string>();
  for (const a of parsed) {
    const m = /^admin:([a-z][a-z0-9-]*)(\.|$)/.exec(a);
    if (!m) return { kind: 'mixed' };
    resources.add(m[1]);
  }
  if (resources.size === 1) {
    return { kind: 'scoped', resource: [...resources][0] };
  }
  return { kind: 'mixed' };
}

// Canonical regexes — mirror the Go-side TestAllAdminActionStringsAreCanonical
// gate. Used by ChipInput to flag invalid tokens at type time rather than at
// save time. admin:* / admin:*.read / admin:provider.* are all considered
// valid because the IAM engine's globMatch handles them.
export const CANONICAL_ACTION_RE =
  /^admin:(\*|[a-z][a-z0-9-]*(\.\*|\.[a-z][a-z-]*)?|\*\.[a-z][a-z-]*)$/;
export const CANONICAL_NRN_RE =
  /^nrn:nexus:[a-z*][a-z-]*:[^:]+:[a-z*][a-z0-9-]*\/[^/]+$/;

// Sentinel values for the service-scope dropdowns — user-intent flags,
// not catalog resource names; prefixed with __ to avoid collision.
// Statement scope is expressed as a two-level hierarchy (service → resource)
// mirroring the Simulator + SIEM filter UIs. The intendedScopes string encodes:
//
//   ''                    — pick mode (no intent yet)
//   '__wildcard__'        — cross-service admin:* (full platform)
//   '__mixed__'           — multi-resource / advanced chip input
//   '__svc__:<service>'   — service picked, resource not yet
//   '__svc-all__:<svc>'   — service + "all resources" (service-wildcard)
//   '<resource>'          — specific resource (service inferred via catalog)
export const SCOPE_MIXED = '__mixed__';
export const SCOPE_WILDCARD = '__wildcard__';
export const SCOPE_PICK = '';
export const SCOPE_SVC_PREFIX = '__svc__:';
export const SCOPE_SVC_ALL_PREFIX = '__svc-all__:';
// Resource-select special value: "all resources in service".
export const RESOURCE_ALL = '*';

// Canonical service order for the Service dropdown.
export const SERVICE_ORDER = ['gateway', 'compliance', 'agent', 'platform', 'iam'] as const;
export type ServiceName = typeof SERVICE_ORDER[number];
export const isService = (s: string): s is ServiceName =>
  (SERVICE_ORDER as readonly string[]).includes(s);

// Selected scope — derived state, computed each render from
// (intendedScopes, statement actions, statement resources). The Service
// and Resource selects render from this; setters update intendedScopes
// (and side-effect actions/resources fields as needed).
export type SelectedScope =
  | { kind: 'pick' }
  | { kind: 'wildcard' }
  | { kind: 'mixed' }
  | { kind: 'service'; service: ServiceName }
  | { kind: 'service-wildcard'; service: ServiceName }
  | { kind: 'resource'; service: ServiceName; resource: string };

const SVC_WILDCARD_NRN_RE = /^nrn:nexus:([a-z][a-z-]*):\*:\*\/\*$/;

export function computeSelectedScope(
  stmt: StatementEntry,
  intended: string | undefined,
  catalogResp: ActionCatalogResponse | null | undefined,
): SelectedScope {
  // 1. Explicit user intent wins.
  if (intended === SCOPE_WILDCARD) return { kind: 'wildcard' };
  if (intended === SCOPE_MIXED) return { kind: 'mixed' };
  if (intended?.startsWith(SCOPE_SVC_ALL_PREFIX)) {
    const s = intended.slice(SCOPE_SVC_ALL_PREFIX.length);
    if (isService(s)) return { kind: 'service-wildcard', service: s };
  }
  if (intended?.startsWith(SCOPE_SVC_PREFIX)) {
    const s = intended.slice(SCOPE_SVC_PREFIX.length);
    if (isService(s)) return { kind: 'service', service: s };
  }
  if (intended && intended !== '' && !intended.startsWith('__')) {
    const r = catalogResp?.resources.find((x) => x.type === intended);
    if (r && isService(r.service)) {
      return { kind: 'resource', service: r.service, resource: intended };
    }
  }

  // 2. Inferred from current state.
  const mode = inferStatementMode(stmt.actions, intended);
  if (mode.kind === 'wildcard') {
    // Distinguish service-scoped wildcard via Resource NRN field.
    const resources = stmt.resources.split('\n').map((x) => x.trim()).filter(Boolean);
    if (resources.length === 1) {
      const m = SVC_WILDCARD_NRN_RE.exec(resources[0]);
      if (m && isService(m[1])) return { kind: 'service-wildcard', service: m[1] };
    }
    return { kind: 'wildcard' };
  }
  if (mode.kind === 'scoped') {
    const r = catalogResp?.resources.find((x) => x.type === mode.resource);
    if (r && isService(r.service)) {
      return { kind: 'resource', service: r.service, resource: mode.resource };
    }
    return { kind: 'pick' };
  }
  if (mode.kind === 'mixed') return { kind: 'mixed' };
  if (mode.kind === 'empty' && mode.intended) {
    const r = catalogResp?.resources.find((x) => x.type === mode.intended);
    if (r && isService(r.service)) {
      return { kind: 'resource', service: r.service, resource: mode.intended };
    }
  }
  return { kind: 'pick' };
}

// Parse + serialize helpers shared between the chip input value and
// the CatalogPicker / ScopedActionsPicker array models.
export const actionsAsArray = (s: string) =>
  s.split('\n').map((x) => x.trim()).filter(Boolean);
export const actionsAsString = (arr: string[]) => arr.join('\n');

// Compact one-line summary for the collapsed header. Shows at-a-glance
// what the statement grants without expanding.
export function summarizeStatement(s: StatementEntry) {
  const actions = s.actions.split('\n').map((a) => a.trim()).filter(Boolean);
  const resources = s.resources.split('\n').map((r) => r.trim()).filter(Boolean);
  const fmt = (list: string[]) => {
    if (list.length === 0) return null;
    if (list.length === 1) return { head: list[0], extra: 0 };
    return { head: list[0], extra: list.length - 1 };
  };
  return { actions: fmt(actions), resources: fmt(resources) };
}
