import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Grid, Card, ExpandableWrapper, Sparkline, AnimatedNumber } from '@/components/ui';
import type { LatencyPhaseRow } from '@/api/services/overview/analytics';
import styles from './DashboardPage.module.css';
import { InfoIcon } from './dashboardShared';

interface SparkData {
  requests: number[];
  errors: number[];
  latency: number[];
  cost: number[];
  tokens: number[];
  cacheHitRate: number[];
  cacheSavings: number[];
}

interface HealthCardsProps {
  sparkData: SparkData;
  animRequests: number;
  vkRequests: number;
  proxyTotalRequests: number;
  vkRequestsPct: number;
  proxyRequestsPct: number;
  errorRateClass: string;
  animErrorRate10x: number;
  animErrors: number;
  animP95: number;
  animAvg: number;
  latencyPhases: { rows?: LatencyPhaseRow[] } | null | undefined;
  proxyReachable: boolean | null;
  proxyCoveragePercent: number;
  coverageSpark: number[];
  windowLabel: string;
}

export function HealthCards({
  sparkData,
  animRequests,
  vkRequests,
  proxyTotalRequests,
  vkRequestsPct,
  proxyRequestsPct,
  errorRateClass,
  animErrorRate10x,
  animErrors,
  animP95,
  animAvg,
  latencyPhases,
  proxyReachable,
  proxyCoveragePercent,
  coverageSpark,
  windowLabel,
}: HealthCardsProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* ── Section 1: System Health ────────────────────────────────────── */}
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{t('pages:dashboard.sectionSystemHealth')}</h2>
        <p className={styles.sectionSubtitle}>{t('pages:dashboard.sectionSystemHealthSubtitle')}</p>
      </div>

      <Grid columns={4} gap="md">
        {/* Combined Requests */}
        <ExpandableWrapper>
          <Card padding="lg" className={styles.metricCard}>
            <div className={styles.metricLabelRow}>
              {t('pages:dashboard.combinedRequests')}
              <InfoIcon description={t('pages:dashboard.combinedRequestsDesc')} />
            </div>
            <div className={styles.metricValueRow}>
              <span className={styles.metricValue}>{animRequests.toLocaleString()}</span>
              <Sparkline data={sparkData.requests} color="var(--color-primary)" />
            </div>
            <div className={styles.splitBar}>
              <div title={t('pages:dashboard.splitBarVk', { count: vkRequests.toLocaleString() })} className={styles.splitBarVk} style={{ width: `${vkRequestsPct}%` }} />
              <div title={t('pages:dashboard.splitBarProxy', { count: proxyTotalRequests.toLocaleString() })} className={styles.splitBarProxy} style={{ width: `${proxyRequestsPct}%` }} />
            </div>
            <span className={styles.metricSubtitle}>
              {t('pages:dashboard.splitBarSubtitle', { vk: vkRequests.toLocaleString(), proxy: proxyTotalRequests.toLocaleString() })}
            </span>
          </Card>
        </ExpandableWrapper>

        {/* Error Rate */}
        <ExpandableWrapper>
          <Card padding="lg" className={styles.metricCard}>
            <div className={styles.metricLabelRow}>
              {t('pages:dashboard.errorRateLabel')}
              <InfoIcon description={t('pages:dashboard.errorRateDesc')} />
            </div>
            <div className={styles.metricValueRow}>
              <span className={errorRateClass}>{(animErrorRate10x / 10).toFixed(1)}%</span>
              <Sparkline data={sparkData.errors} color="var(--color-danger)" />
            </div>
            <span className={styles.metricSubtitle}>{t('pages:dashboard.errorsAndRejects', { count: animErrors.toLocaleString() })}</span>
          </Card>
        </ExpandableWrapper>

        {/* P95 Latency — keeps the sparkline that makes this card
            unique, but the subtitle now exposes the phase breakdown
            (Us / TTFB / Upstream) using the busiest provider's P95
            from latencyPhases when available. Lets the eye scan
            "1573ms · Us 3 · TTFB 1.2s · Upstream 1.6s" at a glance —
            same direction as Provider Usage / Detail cards. Falls
            back to the old avg subtitle when latencyPhases is empty. */}
        <ExpandableWrapper>
          <Card padding="lg" className={styles.metricCard}>
            <div className={styles.metricLabelRow}>
              {t('pages:dashboard.p95LatencyLabel')}
              <InfoIcon description={t('pages:dashboard.p95LatencyDesc')} />
            </div>
            <div className={styles.metricValueRow}>
              <span className={styles.metricValue}>{animP95}ms</span>
              <Sparkline data={sparkData.latency} color="var(--color-warning)" />
            </div>
            {(() => {
              const topPhase = latencyPhases?.rows
                ? [...latencyPhases.rows].sort((a, b) => b.requestCount - a.requestCount)[0]
                : null;
              const fmt = (v: number | null | undefined): string =>
                v == null ? '—' : v < 1000 ? `${v}ms` : `${(v / 1000).toFixed(2)}s`;
              if (topPhase && (topPhase.usOverheadP95Ms != null || topPhase.upstreamTtfbP95Ms != null || topPhase.upstreamTotalP95Ms != null)) {
                const parts: string[] = [];
                if (topPhase.usOverheadP95Ms != null) parts.push(`Us ${fmt(topPhase.usOverheadP95Ms)}`);
                if (topPhase.upstreamTtfbP95Ms != null) parts.push(`TTFB ${fmt(topPhase.upstreamTtfbP95Ms)}`);
                if (topPhase.upstreamTotalP95Ms != null) parts.push(`Upstream ${fmt(topPhase.upstreamTotalP95Ms)}`);
                return (
                  <span className={styles.metricSubtitle} title={t('pages:dashboard.latencyPhaseHint', 'P95 split by busiest provider')}>
                    {parts.join(' · ')}
                  </span>
                );
              }
              return <span className={styles.metricSubtitle}>{t('pages:dashboard.avgLatencyLabel', { value: animAvg })}</span>;
            })()}
          </Card>
        </ExpandableWrapper>

        {/* Compliance Coverage */}
        <ExpandableWrapper>
          <Card padding="lg" className={styles.metricCard}>
            <div className={styles.metricLabelRow}>
              {t('pages:dashboard.complianceCoverage')}
              <InfoIcon description={t('pages:dashboard.complianceCoverageDesc')} />
            </div>
            <div className={styles.metricValueRow}>
              <span
                className={clsx(
                  styles.metricValue,
                  proxyReachable === false ? styles.coverageMuted
                    : proxyCoveragePercent >= 95 ? styles.coverageSuccess
                    : proxyCoveragePercent >= 80 ? styles.coverageWarning
                    : styles.coverageDanger,
                )}
              >
                {proxyReachable === false ? '—' : <AnimatedNumber value={proxyCoveragePercent} precision={1} format={(n) => `${n.toFixed(1)}%`} />}
              </span>
              <Sparkline
                data={coverageSpark}
                color={
                  proxyReachable === false ? 'var(--color-text-muted)'
                    : proxyCoveragePercent >= 95 ? 'var(--color-success)'
                    : proxyCoveragePercent >= 80 ? 'var(--color-warning)'
                    : 'var(--color-danger)'
                }
              />
            </div>
            <span className={styles.metricSubtitle}>
              {proxyReachable === false ? t('pages:dashboard.proxyNotReachable') : windowLabel}
            </span>
          </Card>
        </ExpandableWrapper>
      </Grid>
    </>
  );
}
