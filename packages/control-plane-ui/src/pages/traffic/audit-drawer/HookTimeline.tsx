import type { BlockingRule, HookExecutionRecord } from '../../../api/types';
import { Stack } from '@/components/ui';
import { Block, DecisionBadge } from './auditDrawerPrimitives';
import css from './trafficAuditDrawer.module.css';

// ── Hook execution helpers ───────────────────────────────────────────────────

// hookFields normalises a HookExecutionRecord across the two casings
// the data planes serialize today. Compliance-proxy sends PascalCase
// (HookName/HookID/Decision/…) because shared/hooks.HookResult has no
// json struct tags; ai-gateway sends lowerCamel (name/hookId/…).
function hookFields(r: HookExecutionRecord) {
  const id = r.hookId ?? r.HookID ?? '';
  const name = r.hookName ?? r.HookName ?? r.name ?? '';
  const impl = r.implementationId ?? r.ImplementationID ?? '';
  const decision = r.decision ?? r.Decision ?? '';
  const reason = r.reason ?? r.Reason ?? '';
  const reasonCode = r.reasonCode ?? r.ReasonCode ?? '';
  const latencyMs = r.latencyMs ?? r.LatencyMs;
  const order = r.order ?? r.Order ?? 0;
  const error = r.error ?? r.Error ?? '';
  return { id, name, impl, decision, reason, reasonCode, latencyMs, order, error };
}

export function PipelineTimeline({
  label,
  rows,
  emptyLabel,
}: {
  label: string;
  rows: HookExecutionRecord[] | null | undefined;
  emptyLabel: string;
}) {
  if (!rows || rows.length === 0) {
    return (
      <div>
        <div className={css.detailLabel}>{label}</div>
        <div className={`${css.detailValue} ${css.mutedText}`}>{emptyLabel}</div>
      </div>
    );
  }
  const ordered = [...rows]
    .map((r) => ({ raw: r, ...hookFields(r) }))
    .sort((a, b) => a.order - b.order);
  return (
    <div>
      <div className={css.detailLabel}>{label} ({ordered.length})</div>
      <Stack gap="xs">
        {ordered.map((r, idx) => {
          const primary = r.name || r.id || 'hook';
          const showId = !!r.name && r.id;
          return (
            <div
              key={`${r.id || r.name || idx}`}
              className={css.hookCard}
            >
              <Stack direction="horizontal" justify="between" align="center" gap="sm">
                <Stack direction="horizontal" gap="sm" align="center">
                  <strong>{primary}</strong>
                  {r.impl && (
                    <span className={css.hookImplText}>
                      {r.impl}
                    </span>
                  )}
                </Stack>
                <DecisionBadge decision={r.decision} />
              </Stack>
              {showId && (
                <div className={css.hookIdText}>
                  id: <span className={css.mono}>{r.id}</span>
                </div>
              )}
              {(r.reason || r.reasonCode || r.latencyMs != null || r.error) && (
                <div className={css.hookDetailText}>
                  {r.reasonCode && <span style={{ marginRight: 'var(--g-space-2)' }}>[{r.reasonCode}]</span>}
                  {r.reason && <span style={{ marginRight: 'var(--g-space-2)' }}>{r.reason}</span>}
                  {r.latencyMs != null && <span style={{ marginRight: 'var(--g-space-2)' }}>{r.latencyMs} ms</span>}
                  {r.error && <span className={css.hookErrorText}>error: {r.error}</span>}
                </div>
              )}
            </div>
          );
        })}
      </Stack>
    </div>
  );
}

export function BlockingRuleLine({ label, rule }: { label: string; rule: BlockingRule | null | undefined }) {
  if (!rule) return null;
  return (
    <Block label={label}>
      <span className={css.mono}>
        {rule.pack}@{rule.packVersion} · {rule.ruleId}
      </span>
    </Block>
  );
}
