import { useTranslation } from 'react-i18next';
import type { BulkDiagModeResult } from '@/api/services/infrastructure/diag/diagmode';
import { Stack, Card, ErrorBanner } from '@/components/ui';
import styles from './InfraDiagModePage.module.css';

interface ResultPanelsProps {
  bulkResult: BulkDiagModeResult | null;
  bulkError: string | null;
}

export function ResultPanels({ bulkResult, bulkError }: ResultPanelsProps) {
  const { t } = useTranslation('pages');

  // Banner state derived from bulkResult.
  const bulkSucceeded = bulkResult && bulkResult.ok && bulkResult.failed === 0;
  const bulkPartial = bulkResult && bulkResult.failed > 0 && bulkResult.failed < bulkResult.total;
  const bulkAllFailed = bulkResult && bulkResult.failed > 0 && bulkResult.failed === bulkResult.total;
  const bulkOkCount = bulkResult ? bulkResult.total - bulkResult.failed : 0;
  const bulkFailedItems = bulkResult ? bulkResult.items.filter((i) => !i.ok) : [];

  return (
    <>
      {/* ── Bulk result panels ── */}
      {bulkError && <ErrorBanner message={bulkError} />}

      {bulkSucceeded && (
        <Card className={styles.successCard}>
          <Stack gap="xs">
            <h3 className={styles.sectionTitle}>
              {t('infrastructure.diagMode.bulkSuccessTitle')}
            </h3>
            <p>
              {t('infrastructure.diagMode.bulkSuccessSummary', {
                count: bulkResult.total,
              })}
            </p>
          </Stack>
        </Card>
      )}

      {bulkPartial && bulkResult && (
        <Card className={styles.warningCard}>
          <Stack gap="sm">
            <h3 className={styles.sectionTitle}>
              {t('infrastructure.diagMode.bulkPartialTitle')}
            </h3>
            <p>
              {t('infrastructure.diagMode.bulkPartialSummary', {
                ok: bulkOkCount,
                fail: bulkResult.failed,
              })}
            </p>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>{t('infrastructure.diagMode.colThing')}</th>
                  <th>{t('infrastructure.diagMode.colError')}</th>
                </tr>
              </thead>
              <tbody>
                {bulkFailedItems.map((item) => (
                  <tr key={item.nodeId}>
                    <td className={styles.codeCell}>{item.nodeId}</td>
                    <td>{item.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Stack>
        </Card>
      )}

      {bulkAllFailed && bulkResult && (
        <Card className={styles.warningCard}>
          <Stack gap="sm">
            <h3 className={styles.sectionTitle}>
              {t('infrastructure.diagMode.bulkFailedTitle')}
            </h3>
            <p>
              {t('infrastructure.diagMode.bulkFailedSummary', {
                count: bulkResult.failed,
              })}
            </p>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>{t('infrastructure.diagMode.colThing')}</th>
                  <th>{t('infrastructure.diagMode.colError')}</th>
                </tr>
              </thead>
              <tbody>
                {bulkFailedItems.map((item) => (
                  <tr key={item.nodeId}>
                    <td className={styles.codeCell}>{item.nodeId}</td>
                    <td>{item.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Stack>
        </Card>
      )}
    </>
  );
}
