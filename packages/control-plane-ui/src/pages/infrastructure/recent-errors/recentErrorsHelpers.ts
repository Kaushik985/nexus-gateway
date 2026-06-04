import type { DiagGroup } from '@/api/services/infrastructure/diag/diagevents';

export const TIME_RANGE_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export const ALL = '__all__';
export const NODE_TYPE_OPTIONS = ['agent', 'ai-gateway', 'compliance-proxy', 'control-plane', 'nexus-hub'];

/** Compact local-time string for table cells. */
export function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

/** "3m ago" / "2h ago" relative formatter — kept short and dependency-free. */
export function fmtRelative(iso: string, t: (k: string, p?: any) => string): string {
  const delta = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.round(delta / 60000);
  if (m < 1) return t('infrastructure.recentErrors.relativeJustNow');
  if (m < 60) return t('infrastructure.recentErrors.relativeMin', { n: m });
  const h = Math.round(m / 60);
  if (h < 48) return t('infrastructure.recentErrors.relativeHour', { n: h });
  const d = Math.round(h / 24);
  return t('infrastructure.recentErrors.relativeDay', { n: d });
}

export function rangeBounds(rangeKey: string): { from: string; to: string } {
  const ms = TIME_RANGE_MS[rangeKey] ?? TIME_RANGE_MS['24h'];
  const now = Date.now();
  return { from: new Date(now - ms).toISOString(), to: new Date(now).toISOString() };
}

export function levelBadgeVariant(level: string): 'danger' | 'warning' | 'info' {
  const lvl = String(level).toLowerCase();
  if (lvl === 'fatal') return 'danger';
  if (lvl === 'error') return 'danger';
  if (lvl === 'warn') return 'warning';
  return 'info';
}

/** Pluck the integer counts out of a group's buckets array. */
export function bucketCounts(buckets: DiagGroup['buckets']): number[] {
  return (buckets ?? []).map((b) => b.count);
}

export interface HeroStats {
  errorsThisHour: number;
  errorsPrevHour: number;
  activeIssues: number;
  topOffenderSource: string;
  topOffenderPct: number;
  newestIssue: DiagGroup | null;
  fleetSparkline: number[];
}

/**
 * Roll up the hero-tile inputs from the groups response. All groups in
 * the response cover the requested [from, to) window, so we project
 * onto the last hour from `buckets`.
 */
export function computeHero(groups: DiagGroup[]): HeroStats {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const twoHrAgo = Date.now() - 2 * 60 * 60 * 1000;

  let errorsThisHour = 0;
  let errorsPrevHour = 0;
  let activeIssues = 0;
  let newestIssue: DiagGroup | null = null;
  const sourceTotals = new Map<string, number>();
  const fleetBucketCount = new Map<string, number>();

  for (const g of groups) {
    const lvl = String(g.maxLevel ?? g.level ?? '').toLowerCase();
    const isHigh = lvl === 'error' || lvl === 'fatal';
    if (isHigh && !g.silenced) activeIssues += 1;
    sourceTotals.set(g.source, (sourceTotals.get(g.source) ?? 0) + g.totalOccurrences);

    for (const b of g.buckets ?? []) {
      const ts = new Date(b.ts).getTime();
      if (isHigh && ts >= hourAgo) errorsThisHour += b.count;
      else if (isHigh && ts >= twoHrAgo && ts < hourAgo) errorsPrevHour += b.count;
      fleetBucketCount.set(b.ts, (fleetBucketCount.get(b.ts) ?? 0) + b.count);
    }

    if (!newestIssue) newestIssue = g;
    else if (new Date(g.firstSeen).getTime() > new Date(newestIssue.firstSeen).getTime()) {
      newestIssue = g;
    }
  }

  let topOffenderSource = '';
  let topOffenderTotal = 0;
  let allTotal = 0;
  for (const [src, n] of sourceTotals) {
    allTotal += n;
    if (n > topOffenderTotal) { topOffenderSource = src; topOffenderTotal = n; }
  }
  const topOffenderPct = allTotal > 0 ? topOffenderTotal / allTotal : 0;

  const fleetSparkline = Array.from(fleetBucketCount.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, n]) => n);

  return {
    errorsThisHour,
    errorsPrevHour,
    activeIssues,
    topOffenderSource,
    topOffenderPct,
    newestIssue,
    fleetSparkline,
  };
}
