// Single source of truth for mapping a node / device (Thing) status to a Badge
// variant. Shared by the Infrastructure node pages and the Devices pages so a
// given status always renders with the same color.
//
// The Hub writes these statuses into the `thing.status` column: `online`,
// `offline`, `enrolled`, `revoked`, and `drift`. `drift` is set by the
// drift-reconciliation job when a node's applied config trails its target; it
// renders as a warning — the node is still serving traffic, but its
// configuration has not converged, which is exactly what the Config Sync
// Out-of-Sync Monitor surfaces for action.
//
// The uppercase aliases (`ACTIVE`/`ENROLLED`/`OFFLINE`/`REVOKED`) map older
// AgentDevice rows and the Devices status-filter values to the same colors.
export type StatusVariant = 'success' | 'warning' | 'default' | 'danger';

export function thingStatusVariant(status: string): StatusVariant {
  const map: Record<string, StatusVariant> = {
    online: 'success',
    enrolled: 'warning',
    offline: 'default',
    drift: 'warning',
    revoked: 'danger',
    // Uppercase aliases for older AgentDevice rows written before the enum was lowercased.
    ACTIVE: 'success',
    ENROLLED: 'warning',
    OFFLINE: 'default',
    REVOKED: 'danger',
  };
  return map[status] ?? map[status.toLowerCase()] ?? 'default';
}
