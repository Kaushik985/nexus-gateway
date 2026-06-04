import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { analyticsApi } from '@/api/services';
import { useApi } from '../../hooks/useApi';
import {
  PageHeader, LoadingSpinner, ErrorBanner, Card, Stack,
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui';
import { MetricsRollupsSection } from '../metrics/MetricsRollupsSection';
import { LatencyPhasesPanel } from './LatencyPhasesPanel';
import { AnalyticsKpiSection } from './AnalyticsKpiSection';
import { AnalyticsChartsSection } from './AnalyticsChartsSection';
import { BreakdownTable } from './AnalyticsBreakdownSection';
import { useTheme } from '../../theme/useTheme';
import { getPieColors, getTooltipStyle } from '@nexus-gateway/ui-shared';
import type { AnalyticsSummary, CostData, UsageData } from '../../api/types';
import type { CacheROISummary } from '@/api/services/overview/analytics';
import styles from './AnalyticsPage.module.css';

type TimeRange = '24h' | '7d' | '30d' | 'custom';
type GroupBy = 'provider' | 'model' | 'project' | 'organization' | 'user' | 'virtual_key' | 'host' | 'device';

function computeTimeRange(range: TimeRange, customStart: string, customEnd: string): { startTime: string; endTime: string } {
  const now = new Date();
  if (range === 'custom') {
    return {
      startTime: customStart || new Date(now.getTime() - 24 * 3600_000).toISOString(),
      endTime: customEnd || now.toISOString(),
    };
  }
  const hours = range === '24h' ? 24 : range === '7d' ? 168 : 720;
  return {
    startTime: new Date(now.getTime() - hours * 3600_000).toISOString(),
    endTime: now.toISOString(),
  };
}

/* ── Main page ───────────────────────────────────────────────────────────── */

export function AnalyticsPage() {
  const { t } = useTranslation();
  const { resolvedMode } = useTheme();

  const TIME_RANGE_OPTIONS = useMemo(() => [
    { value: '24h' as TimeRange, label: t('pages:traffic.timeRangeLast24h') },
    { value: '7d' as TimeRange, label: t('pages:traffic.timeRangeLast7d') },
    { value: '30d' as TimeRange, label: t('pages:traffic.timeRangeLast30d') },
    { value: 'custom' as TimeRange, label: t('pages:traffic.timeRangeCustom') },
  ], [t]);

  const pieColors = getPieColors(resolvedMode);
  const tooltipStyle = getTooltipStyle(resolvedMode);
  const [activeTab, setActiveTab] = useState('analytics');
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [groupBy, setGroupBy] = useState<GroupBy>('provider');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [source, setSource] = useState<'' | 'vk' | 'proxy' | 'agent'>('');

  const GROUP_BY_OPTIONS = useMemo(() => {
    const all: { value: GroupBy; label: string }[] = [
      { value: 'provider', label: t('pages:analytics.groupBy_provider') },
      { value: 'model', label: t('pages:analytics.groupBy_model') },
      { value: 'user', label: t('pages:analytics.groupBy_user') },
      { value: 'organization', label: t('pages:analytics.groupBy_organization') },
      { value: 'virtual_key', label: t('pages:analytics.groupBy_virtual_key') },
      { value: 'host', label: t('pages:analytics.groupBy_host') },
      { value: 'device', label: t('pages:analytics.groupBy_device') },
      { value: 'project', label: t('pages:analytics.groupBy_project') },
    ];
    switch (source) {
      case 'vk': return all.filter(o => ['provider', 'model', 'user', 'virtual_key', 'organization', 'project'].includes(o.value));
      case 'proxy': return all.filter(o => ['host', 'user', 'organization'].includes(o.value));
      case 'agent': return all.filter(o => ['device', 'host', 'user'].includes(o.value));
      default: return all;
    }
  }, [t, source]);

  const { startTime, endTime } = useMemo(
    () => computeTimeRange(timeRange, customStart, customEnd),
    [timeRange, customStart, customEnd],
  );

  const apiParams = useMemo(() => {
    const p: Record<string, string> = { startTime, endTime };
    if (source) p.source = source;
    return p;
  }, [startTime, endTime, source]);

  /* Reset groupBy when source changes and current option is unavailable */
  const groupByValues = useMemo(() => GROUP_BY_OPTIONS.map(o => o.value), [GROUP_BY_OPTIONS]);
  useEffect(() => {
    if (!groupByValues.includes(groupBy)) {
      setGroupBy(groupByValues[0] ?? 'provider');
    }
  }, [source, groupByValues, groupBy]);

  const showVKMetrics = source === '' || source === 'vk';

  const { data: summary, loading, error, refetch } = useApi<AnalyticsSummary>(
    () => analyticsApi.summary(apiParams),
    ['admin', 'analytics', 'summary', startTime, endTime, source],
  );
  const { data: costData } = useApi<{ data: CostData[] }>(
    () => analyticsApi.cost({ groupBy, ...apiParams }),
    ['admin', 'analytics', 'cost', groupBy, startTime, endTime, source],
  );
  const { data: usageData } = useApi<{ data: UsageData[] }>(
    () => analyticsApi.usage({ groupBy, ...apiParams }),
    ['admin', 'analytics', 'usage', groupBy, startTime, endTime, source],
  );
  const { data: cacheROI } = useApi<CacheROISummary>(
    () => analyticsApi.cacheROI({ start: startTime, end: endTime }),
    ['admin', 'analytics', 'cache-roi', startTime, endTime],
  );

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBanner message={error.message} onRetry={refetch} />;
  if (!summary) return null;

  return (
    <Stack gap="lg">
      <PageHeader title={t('pages:traffic.analytics')} />

      {/* ── Filter bar (page-level, affects both tabs) ───────────── */}
      <Card className={styles.filterCard}>
        <label className={styles.filterGroup}>
          <span className={styles.filterLabel}>{t('pages:traffic.labelTimeRange')}</span>
          <select value={timeRange} onChange={(e) => setTimeRange(e.target.value as TimeRange)} className={styles.filterSelect}>
            {TIME_RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        {timeRange === 'custom' && (
          <div className={styles.filterGroup}>
            <input
              type="datetime-local"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value ? new Date(e.target.value).toISOString() : '')}
              className={styles.filterInput}
            />
            <span className={styles.filterLabel}>to</span>
            <input
              type="datetime-local"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value ? new Date(e.target.value).toISOString() : '')}
              className={styles.filterInput}
            />
          </div>
        )}
        <label className={styles.filterGroup}>
          <span className={styles.filterLabel}>{t('pages:traffic.labelGroupBy')}</span>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className={styles.filterSelect}>
            {GROUP_BY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>{t('pages:analytics.sourceFilter')}</span>
          <div className={styles.buttonGroup}>
            {([
              { value: '' as const, label: t('pages:analytics.sourceAll') },
              { value: 'vk' as const, label: t('pages:analytics.sourceVK') },
              { value: 'proxy' as const, label: t('pages:analytics.sourceProxy') },
              { value: 'agent' as const, label: t('pages:analytics.sourceAgent') },
            ]).map(opt => (
              <button
                key={opt.value}
                type="button"
                className={`${styles.filterBtn} ${source === opt.value ? styles.filterBtnActive : ''}`}
                onClick={() => setSource(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="analytics">{t('pages:traffic.analytics')}</TabsTrigger>
          <TabsTrigger value="latency">{t('pages:analytics.latencyTab', 'Latency')}</TabsTrigger>
          <TabsTrigger value="metrics">{t('pages:traffic.metrics')}</TabsTrigger>
        </TabsList>

        <TabsContent value="metrics">
          <MetricsRollupsSection embedded source={source} externalStart={startTime} externalEnd={endTime} />
        </TabsContent>

        <TabsContent value="latency">
          <LatencyPhasesPanel start={startTime} end={endTime} source={source} />
        </TabsContent>

        <TabsContent value="analytics">
          <Stack gap="lg">

          {/* Chips */}
          {(timeRange !== '7d' || groupBy !== 'provider') && (
            <div className={styles.chipBar}>
              {timeRange !== '7d' && (
                <span className={styles.chip}>
                  {timeRange === 'custom' ? t('pages:traffic.customRange') : TIME_RANGE_OPTIONS.find((o) => o.value === timeRange)?.label}
                  <button onClick={() => setTimeRange('7d')} className={styles.chipClose} aria-label={t('pages:traffic.resetTimeRange')}>&times;</button>
                </span>
              )}
              {groupBy !== 'provider' && (
                <span className={styles.chip}>
                  {t('pages:traffic.byGroupBy', { groupBy })}
                  <button onClick={() => setGroupBy('provider')} className={styles.chipClose} aria-label={t('pages:traffic.resetGroupBy')}>&times;</button>
                </span>
              )}
            </div>
          )}

          {/* ── KPI stats ─────────────────────────────────────────── */}
          <AnalyticsKpiSection summary={summary} showVKMetrics={showVKMetrics} cacheROI={cacheROI} />

          {/* ── Distribution charts (VK only) ──────────────────────── */}
          {showVKMetrics && (
            <AnalyticsChartsSection
              groupBy={groupBy}
              costData={costData}
              usageData={usageData}
              pieColors={pieColors}
              tooltipStyle={tooltipStyle}
              resolvedMode={resolvedMode}
            />
          )}

          {/* ── Breakdown table (controlled by page-level GroupBy) ──── */}
          <BreakdownTable
            title={t('pages:analytics.breakdownBy') + ' ' + t(`pages:analytics.groupBy_${groupBy}`)}
            nameLabel={t(`pages:analytics.groupBy_${groupBy}`)}
            groupByKey={groupBy}
            timeParams={apiParams}
          />

          </Stack>
        </TabsContent>
      </Tabs>
    </Stack>
  );
}
