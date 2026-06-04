import { useTranslation } from 'react-i18next';
import { AnimatedNumber } from '@/components/ui';
import type { MetricAggregatePoint } from '../../api/types';
import { formatUsd, formatCompact, formatTokens } from '@/lib/format';
import styles from './MetricsRollupsSection.module.css';
import { StatCard } from './metrics-rollups-helpers';

interface KpiTotals {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  totalErrors: number;
  totalCacheHits: number;
  totalCacheSaved: number;
}

interface KpiCardsProps {
  hasExternal: boolean;
  hours: number;
  setHours: (hours: number) => void;
  kpis: KpiTotals | null;
  totalPoints: number;
  adminAuthRows: MetricAggregatePoint[];
}

export function KpiCards({ hasExternal, hours, setHours, kpis, totalPoints, adminAuthRows }: KpiCardsProps) {
  const { t } = useTranslation();

  return (
    <>
      {!hasExternal && (
        <div className={styles.rangeBar}>
          <label className={styles.rangeLabel}>
            <span>{t('pages:metrics.range')}</span>
            <select
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className={styles.rangeSelect}
            >
              <option value={6}>{t('pages:metrics.last6Hours')}</option>
              <option value={24}>{t('pages:metrics.last24Hours')}</option>
              <option value={168}>{t('pages:metrics.last7Days')}</option>
            </select>
          </label>
        </div>
      )}

      {kpis ? (
        <div className={styles.kpiGrid}>
          <StatCard label={t('pages:metrics.totalRequests')} value={<AnimatedNumber value={kpis.totalRequests} format={formatCompact} />} subtitle={t('pages:metrics.totalRequestsSubtitle')} />
          <StatCard label={t('pages:metrics.totalTokens')} value={<AnimatedNumber value={kpis.totalTokens} format={formatTokens} />} subtitle={t('pages:metrics.totalTokensSubtitle')} />
          <StatCard label={t('pages:metrics.estCost')} value={<AnimatedNumber value={kpis.totalCost} precision={2} format={formatUsd} />} subtitle={t('pages:metrics.estCostSubtitle')} />
          <StatCard label={t('pages:metrics.errors')} value={<AnimatedNumber value={kpis.totalErrors} format={formatCompact} />} subtitle={t('pages:metrics.errorsSubtitle')} />
          <StatCard label={t('pages:metrics.cacheHits')} value={<AnimatedNumber value={kpis.totalCacheHits} format={formatCompact} />} subtitle={t('pages:metrics.cacheHitsSubtitle')} />
          {kpis.totalCacheSaved > 0 && (
            <StatCard label={t('pages:metrics.cacheSavings')} value={<AnimatedNumber value={kpis.totalCacheSaved} precision={2} format={formatUsd} />} subtitle={t('pages:metrics.cacheSavingsSubtitle')} />
          )}
          <StatCard label={t('pages:metrics.rollupRows')} value={<AnimatedNumber value={totalPoints} />} subtitle={t('pages:metrics.rollupRowsSubtitle')} />
        </div>
      ) : null}

      {adminAuthRows.length > 0 ? (
        <p className={styles.muted}>
          {t('pages:metrics.adminAuthNote', { count: adminAuthRows.length })}
        </p>
      ) : null}
    </>
  );
}
