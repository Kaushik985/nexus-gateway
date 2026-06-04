import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';
import type { PassthroughSnapshot, PassthroughTier } from '@/api/services';
import { Countdown } from './Countdown';
import { bypassSummary } from './passthroughForm';
import styles from './PassthroughPage.module.css';

export function ActiveBanner({ snapshot }: { snapshot: PassthroughSnapshot }) {
  const { t } = useTranslation();
  // Count enabled rows across all tiers.
  const enabledTiers: { kind: string; key: string; tier: PassthroughTier }[] = [];
  if (snapshot.global.enabled) enabledTiers.push({ kind: 'global', key: 'global', tier: snapshot.global });
  for (const [k, v] of Object.entries(snapshot.adapters)) if (v.enabled) enabledTiers.push({ kind: 'adapter', key: k, tier: v });
  for (const [k, v] of Object.entries(snapshot.providers)) if (v.enabled) enabledTiers.push({ kind: 'provider', key: k, tier: v });

  if (enabledTiers.length === 0) {
    return (
      <div className={styles.bannerInactive}>
        <strong>{t('pages:passthrough.banner.inactiveTitle')}</strong>
        <span>{t('pages:passthrough.banner.inactiveBody')}</span>
      </div>
    );
  }
  return (
    <div className={styles.bannerActive}>
      <div className={styles.bannerTitleRow}>
        <span className={styles.bannerDot} aria-hidden />
        <strong>{t('pages:passthrough.banner.activeTitle', { count: enabledTiers.length })}</strong>
      </div>
      <div className={styles.bannerBody}>{t('pages:passthrough.banner.activeBody')}</div>
      <ul className={styles.bannerList}>
        {enabledTiers.map(e => (
          <li key={`${e.kind}:${e.key}`}>
            <Badge variant="danger">{e.kind}</Badge> <code>{e.key}</code>{' '}
            {bypassSummary(e.tier)} · <Countdown expiresAt={e.tier.expiresAt} />
          </li>
        ))}
      </ul>
    </div>
  );
}
