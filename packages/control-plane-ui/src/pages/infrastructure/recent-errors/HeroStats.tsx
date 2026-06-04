import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui';
import { Sparkline } from '@/components/ui/Sparkline';
import { fmtRelative, type HeroStats as HeroStatsValues } from './recentErrorsHelpers';
import styles from './InfraRecentErrorsPage.module.css';

interface HeroStatsProps {
  hero: HeroStatsValues;
  timeRange: string;
}

export function HeroStats({ hero, timeRange }: HeroStatsProps) {
  const { t } = useTranslation('pages');

  return (
    <>
      {/* ── Hero strip ── */}
      <div className={styles.heroRow}>
        <div className={styles.heroTile}>
          <span className={styles.heroLabel}>{t('infrastructure.recentErrors.tileErrorsPerHour')}</span>
          <span className={styles.heroValue}>{hero.errorsThisHour}</span>
          <span className={styles.heroSub}>
            {hero.errorsThisHour > hero.errorsPrevHour ? (
              <span className={styles.heroSubUp}>↑ </span>
            ) : hero.errorsThisHour < hero.errorsPrevHour ? (
              <span className={styles.heroSubDown}>↓ </span>
            ) : null}
            {t('infrastructure.recentErrors.tileErrorsPerHourSub', { n: hero.errorsPrevHour })}
          </span>
        </div>
        <div className={styles.heroTile}>
          <span className={styles.heroLabel}>{t('infrastructure.recentErrors.tileActiveIssues')}</span>
          <span className={styles.heroValue}>{hero.activeIssues}</span>
          <span className={styles.heroSub}>{t('infrastructure.recentErrors.tileActiveIssuesSub')}</span>
        </div>
        <div className={styles.heroTile}>
          <span className={styles.heroLabel}>{t('infrastructure.recentErrors.tileTopOffender')}</span>
          <span className={styles.heroValue}>{hero.topOffenderSource || '—'}</span>
          <span className={styles.heroSub}>
            {hero.topOffenderSource
              ? t('infrastructure.recentErrors.tileTopOffenderSub', { pct: Math.round(hero.topOffenderPct * 100) })
              : t('infrastructure.recentErrors.empty')}
          </span>
        </div>
        <div className={styles.heroTile}>
          <span className={styles.heroLabel}>{t('infrastructure.recentErrors.tileNewest')}</span>
          <span className={styles.heroValue} style={{ fontSize: 'var(--g-font-size-md)', fontWeight: 'var(--g-font-weight-semibold)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {hero.newestIssue ? hero.newestIssue.sampleMessage : '—'}
          </span>
          <span className={styles.heroSub}>
            {hero.newestIssue ? fmtRelative(hero.newestIssue.firstSeen, t) : t('infrastructure.recentErrors.empty')}
          </span>
        </div>
      </div>

      {hero.fleetSparkline.length >= 2 && (
        <Card>
          <div className={styles.heroSparkRow}>
            <Sparkline
              data={hero.fleetSparkline}
              width={840}
              height={48}
              color="var(--color-danger)"
            />
            <div className={styles.heroSub}>
              {t('infrastructure.recentErrors.fleetSparkSub', { range: t(`infrastructure.recentErrors.range${timeRange}`) })}
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
