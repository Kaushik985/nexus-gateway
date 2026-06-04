import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { AnimatedNumber } from '@/components/ui';
import { formatTokens } from '@/lib/format';
import styles from './DashboardPage.module.css';
import { WINDOW_OPTIONS, type TimeWindow } from './dashboardShared';

interface HeroSectionProps {
  timeWindow: TimeWindow;
  setTimeWindow: (w: TimeWindow) => void;
  animRequests: number;
  vkRequests: number;
  proxyTotalRequests: number;
  animCost100x: number;
  animTokens: number;
  proxyReachable: boolean | null;
  proxyCoveragePercent: number;
  windowLabel: string;
}

export function HeroSection({
  timeWindow,
  setTimeWindow,
  animRequests,
  vkRequests,
  proxyTotalRequests,
  animCost100x,
  animTokens,
  proxyReachable,
  proxyCoveragePercent,
  windowLabel,
}: HeroSectionProps) {
  const { t } = useTranslation();

  return (
    <section className={styles.hero}>
      <div className={styles.heroRow}>
        <div className={styles.heroText}>
          <h1 className={styles.heroTitle}>{t('pages:dashboard.title')}</h1>
          <p className={styles.heroSubtitle}>{t('pages:dashboard.heroSubtitle')}</p>
        </div>
        <div className={styles.windowPicker}>
          {WINDOW_OPTIONS.map((w) => (
            <button
              key={w}
              type="button"
              className={clsx(styles.windowBtn, w === timeWindow && styles.windowBtnActive)}
              onClick={() => setTimeWindow(w)}
            >
              {t(`pages:dashboard.win${w}` as never)}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.heroStats}>
        <div className={styles.heroStat}>
          <span className={styles.heroStatLabel}>{t('pages:dashboard.combinedRequests')}</span>
          <span className={styles.heroStatValue}>{animRequests.toLocaleString()}</span>
          <span className={styles.heroStatSub}>
            {t('pages:dashboard.splitBarSubtitle', { vk: vkRequests.toLocaleString(), proxy: proxyTotalRequests.toLocaleString() })}
          </span>
        </div>
        <div className={styles.heroStat}>
          <span className={styles.heroStatLabel}>{t('pages:dashboard.totalCostLabel')}</span>
          <span className={styles.heroStatValue}>${(animCost100x / 100).toFixed(2)}</span>
          <span className={styles.heroStatSub}>{t('pages:dashboard.estimated')}</span>
        </div>
        <div className={styles.heroStat}>
          <span className={styles.heroStatLabel}>{t('pages:dashboard.totalTokensLabel')}</span>
          <span className={styles.heroStatValue}>{formatTokens(animTokens)}</span>
          <span className={styles.heroStatSub}>{t('pages:dashboard.promptPlusCompletion')}</span>
        </div>
        <div className={styles.heroStat}>
          <span className={styles.heroStatLabel}>{t('pages:dashboard.complianceCoverage')}</span>
          <span className={styles.heroStatValue}>
            {proxyReachable === false ? '—' : <AnimatedNumber value={proxyCoveragePercent} precision={1} format={(n) => `${n.toFixed(1)}%`} />}
          </span>
          <span className={styles.heroStatSub}>
            {proxyReachable === false ? t('pages:dashboard.proxyNotReachable') : windowLabel}
          </span>
        </div>
      </div>
    </section>
  );
}
