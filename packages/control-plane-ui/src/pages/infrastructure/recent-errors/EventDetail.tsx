import { useTranslation } from 'react-i18next';
import type { DiagEvent } from '@/api/services/infrastructure/diag/diagevents';
import { Stack, Button, Dialog } from '@/components/ui';
import { fmtTime } from './recentErrorsHelpers';
import styles from './InfraRecentErrorsPage.module.css';

interface EventDetailProps {
  detailEvent: DiagEvent;
  setDetailEvent: (e: DiagEvent | null) => void;
  enableDiag: {
    mutate: (nodeId: string) => Promise<unknown>;
    loading: boolean;
  };
}

export function EventDetail({ detailEvent, setDetailEvent, enableDiag }: EventDetailProps) {
  const { t } = useTranslation('pages');

  return (
    /* ── Event-detail popup (centered, on top of the drawer) ── */
    <Dialog
      open={!!detailEvent}
      onOpenChange={(open) => { if (!open) setDetailEvent(null); }}
      title={t('infrastructure.recentErrors.eventDetailTitle')}
      size="lg"
    >
      <Stack gap="sm">
        <dl className={styles.detailMeta}>
          <dt>{t('infrastructure.recentErrors.colTime')}</dt>
          <dd>{fmtTime(detailEvent.occurredAt)}</dd>
          <dt>{t('infrastructure.recentErrors.colLevel')}</dt>
          <dd>{String(detailEvent.level).toUpperCase()}</dd>
          <dt>{t('infrastructure.recentErrors.colThing')}</dt>
          <dd className={styles.codeCell}>{detailEvent.nodeId} ({detailEvent.nodeType})</dd>
          <dt>{t('infrastructure.recentErrors.colSource')}</dt>
          <dd>{detailEvent.source}</dd>
          <dt>{t('infrastructure.recentErrors.eventType')}</dt>
          <dd>{detailEvent.eventType}</dd>
          <dt>{t('infrastructure.recentErrors.repeatCount')}</dt>
          <dd>{detailEvent.repeatCount}</dd>
        </dl>

        <div>
          <h4 className={styles.expandedHeading}>{t('infrastructure.recentErrors.colMessage')}</h4>
          <pre className={styles.detailJson}>{detailEvent.message}</pre>
        </div>

        {detailEvent.attrs && Object.keys(detailEvent.attrs).length > 0 && (
          <div>
            <h4 className={styles.expandedHeading}>{t('infrastructure.recentErrors.attrs')}</h4>
            <pre className={styles.detailJson}>{JSON.stringify(detailEvent.attrs, null, 2)}</pre>
          </div>
        )}

        {detailEvent.stackTrace && (
          <div>
            <h4 className={styles.expandedHeading}>{t('infrastructure.recentErrors.stackTrace')}</h4>
            <pre className={styles.detailStack}>{detailEvent.stackTrace}</pre>
          </div>
        )}

        {detailEvent.nodeType === 'agent' && (
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={enableDiag.loading}
              onClick={() => enableDiag.mutate(detailEvent.nodeId).catch(() => undefined)}
            >
              {t('infrastructure.recentErrors.actionEnableDiag')}
            </Button>
          </div>
        )}
      </Stack>
    </Dialog>
  );
}
