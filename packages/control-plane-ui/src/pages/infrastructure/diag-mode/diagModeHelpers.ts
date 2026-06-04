import type { Node } from '@/api/services/infrastructure/nodes/hub';

/** Active-windows polling interval (ms). Spec §11.4: "Refresh every 10 s". */
export const REFRESH_INTERVAL_MS = 10_000;

/** Server-side cap on bulk filter resolution; mirror it client-side. */
export const MAX_BULK_THINGS = 500;

/** Window presets — values in milliseconds, capped at 24 h by the server. */
export const WINDOW_OPTIONS: Array<{ value: string; ms: number }> = [
  { value: '1h', ms: 1 * 60 * 60 * 1000 },
  { value: '4h', ms: 4 * 60 * 60 * 1000 },
  { value: '12h', ms: 12 * 60 * 60 * 1000 },
  { value: '24h', ms: 24 * 60 * 60 * 1000 },
];

export const ANY_VALUE = '__any__';

/** Format a future ISO timestamp as "Nm left" / "Nh left" relative to now. */
export function fmtEndsIn(endedAt: string): string {
  const ms = new Date(endedAt).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return '0m';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}

export function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * Apply the UI filter (thingIds, agentVersion, os) to the agent list. Mirrors
 * the CP `ResolveBulkAgents` semantics on `node.version` (== agentVersion) and
 * `node.metadata.os` (== os, if present). When `thingIds` is non-empty we use
 * it directly and ignore the other criteria — same as the server.
 */
export function applyFilter(
  agents: Node[],
  thingIds: string[],
  agentVersion: string,
  os: string,
): Node[] {
  if (thingIds.length > 0) {
    const set = new Set(thingIds);
    return agents.filter((a) => set.has(a.id));
  }
  return agents.filter((a) => {
    if (agentVersion && (a.version ?? '') !== agentVersion) return false;
    if (os) {
      // Best-effort match against `metadata.os` when the Hub publishes it; if
      // the field is missing we drop the agent rather than over-match.
      const meta = (a as unknown as { metadata?: Record<string, unknown> }).metadata ?? {};
      const agentOs = String(meta.os ?? '');
      if (agentOs !== os) return false;
    }
    return true;
  });
}

/** Parse a textarea blob into a deduped, trimmed list of thing_ids. */
export function parseThingIds(raw: string): string[] {
  const out = new Set<string>();
  for (const line of raw.split(/[\r\n,]+/)) {
    const t = line.trim();
    if (t) out.add(t);
  }
  return Array.from(out);
}
