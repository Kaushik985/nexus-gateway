import { useTranslation } from 'react-i18next';
import { type ReactNode } from 'react';
import { Card, AnimatedNumber } from '@/components/ui';
import type { AnalyticsSummary } from '../../api/types';
import type { CacheROISummary } from '@/api/services/overview/analytics';
import styles from './AnalyticsPage.module.css';
import { formatTokens } from '@/lib/format';

/* ── Stat card ───────────────────────────────────────────────────────────── */

function StatCard({ label, value, subtitle }: { label: string; value: ReactNode; subtitle?: string }) {
  return (
    <Card className={styles.statCard}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      {subtitle && <div className={styles.statSubtitle}>{subtitle}</div>}
    </Card>
  );
}

interface AnalyticsKpiSectionProps {
  summary: AnalyticsSummary;
  showVKMetrics: boolean;
  cacheROI: CacheROISummary | null | undefined;
}

export function AnalyticsKpiSection({ summary, showVKMetrics, cacheROI }: AnalyticsKpiSectionProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.statsGrid}>
      <StatCard
        label={t('pages:traffic.statTotalRequests')}
        value={<AnimatedNumber value={summary.totalRequests} />}
        subtitle={t('pages:traffic.subtitleInSelectedPeriod')}
      />
      {showVKMetrics && (
        <StatCard
          label={t('pages:traffic.statTotalCost')}
          value={<AnimatedNumber value={Number(summary.totalEstimatedCostUsd)} precision={2} format={(n) => `$${n.toFixed(2)}`} />}
          subtitle={t('pages:traffic.subtitleEstimated')}
        />
      )}
      {showVKMetrics && (
        <StatCard
          label={t('pages:traffic.statTotalTokens')}
          value={<AnimatedNumber value={summary.totalTokens} format={formatTokens} />}
          subtitle={t('pages:traffic.subtitlePromptCompletion')}
        />
      )}
      <StatCard
        label={t('pages:traffic.statAvgLatency')}
        value={<AnimatedNumber value={summary.avgLatencyMs} format={(n) => `${Math.round(n)}ms`} />}
        subtitle={t('pages:traffic.subtitleAvgResponseTime')}
      />
      {showVKMetrics && summary.cacheHitRate > 0 && (
        <StatCard
          label={t('pages:traffic.statCacheHitRate')}
          value={<AnimatedNumber value={summary.cacheHitRate * 100} precision={1} format={(n) => `${n.toFixed(1)}%`} />}
          subtitle={t('pages:traffic.subtitleCacheHitRate')}
        />
      )}
      {showVKMetrics && cacheROI && (() => {
        const combinedSavings = (cacheROI.totalGatewayCacheSavingsUsd ?? 0) + cacheROI.totalCacheNetSavingsUsd;
        return combinedSavings !== 0 ? (
          <StatCard
            label={t('pages:analytics.statCacheNetSavings')}
            value={<AnimatedNumber value={combinedSavings} precision={2} format={(n) => `$${n.toFixed(2)}`} />}
            subtitle={t('pages:analytics.subtitleCacheNetSavings')}
          />
        ) : null;
      })()}
    </div>
  );
}
