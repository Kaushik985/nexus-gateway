import { useTranslation } from 'react-i18next';
import type { DiagSilence } from '@/api/services/infrastructure/diag/diagevents';
import { Stack, Button, Badge, Dialog } from '@/components/ui';
import { fmtTime, fmtRelative, levelBadgeVariant } from './recentErrorsHelpers';
import styles from './InfraRecentErrorsPage.module.css';

interface SilencesPopupProps {
  showSilencesPopup: boolean;
  setShowSilencesPopup: (v: boolean) => void;
  silencesData: DiagSilence[] | null;
  unsilenceById: {
    mutate: (id: string) => Promise<unknown>;
    loading: boolean;
  };
}

export function SilencesPopup({
  showSilencesPopup,
  setShowSilencesPopup,
  silencesData,
  unsilenceById,
}: SilencesPopupProps) {
  const { t } = useTranslation('pages');

  return (
    /* ── Active silences popup ──
        Shows every active silence with its expiry (or "permanent")
        and a per-row Unsilence button. Opened from the "Silences (N)"
        button in the Issues header so the operator can audit/cancel
        what they (or another admin) have ack'd.
     */
    <Dialog
      open={showSilencesPopup}
      onOpenChange={(open) => { if (!open) setShowSilencesPopup(false); }}
      title={t('infrastructure.recentErrors.silencesPopupTitle', { n: silencesData?.length ?? 0 })}
      size="lg"
    >
      <Stack gap="sm">
        {(silencesData?.length ?? 0) === 0 ? (
          <div className={styles.empty}>{t('infrastructure.recentErrors.silencesPopupEmpty')}</div>
        ) : (
          <table style={{ width: '100%', fontSize: 'var(--g-font-size-xs)', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 'var(--g-space-1) var(--g-space-2)' }}>{t('infrastructure.recentErrors.colLevel')}</th>
                <th style={{ textAlign: 'left', padding: 'var(--g-space-1) var(--g-space-2)' }}>{t('infrastructure.recentErrors.messageHash')}</th>
                <th style={{ textAlign: 'left', padding: 'var(--g-space-1) var(--g-space-2)' }}>{t('infrastructure.recentErrors.silencedAt')}</th>
                <th style={{ textAlign: 'left', padding: 'var(--g-space-1) var(--g-space-2)' }}>{t('infrastructure.recentErrors.silenceExpires')}</th>
                <th style={{ textAlign: 'left', padding: 'var(--g-space-1) var(--g-space-2)' }}>{t('infrastructure.recentErrors.silenceReason')}</th>
                <th style={{ textAlign: 'left', padding: 'var(--g-space-1) var(--g-space-2)' }}></th>
              </tr>
            </thead>
            <tbody>
              {(silencesData ?? []).map((s) => (
                <tr key={s.id}>
                  <td style={{ padding: 'var(--g-space-1) var(--g-space-2)' }}>
                    <Badge variant={levelBadgeVariant(s.level)}>{String(s.level).toUpperCase()}</Badge>
                  </td>
                  <td style={{ padding: 'var(--g-space-1) var(--g-space-2)' }} className={styles.codeCell}>
                    {s.messageHash.slice(0, 12)}…
                  </td>
                  <td style={{ padding: 'var(--g-space-1) var(--g-space-2)' }}>{fmtTime(s.silencedAt)}</td>
                  <td style={{ padding: 'var(--g-space-1) var(--g-space-2)' }}>
                    {s.expiresAt
                      ? `${fmtTime(s.expiresAt)} (${fmtRelative(s.expiresAt, t)})`
                      : t('infrastructure.recentErrors.silencePermanent')}
                  </td>
                  <td style={{ padding: 'var(--g-space-1) var(--g-space-2)' }} className={styles.codeCell}>
                    {s.reason || '—'}
                  </td>
                  <td style={{ padding: 'var(--g-space-1) var(--g-space-2)', textAlign: 'right' }}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      loading={unsilenceById.loading}
                      onClick={() => unsilenceById.mutate(s.id).catch(() => undefined)}
                    >
                      {t('infrastructure.recentErrors.actionUnsilence')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Stack>
    </Dialog>
  );
}
