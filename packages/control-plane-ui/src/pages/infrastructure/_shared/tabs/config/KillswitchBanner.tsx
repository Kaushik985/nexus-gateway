import { useTranslation } from 'react-i18next';
import type { AppliedConfigEntry } from '@/api/services/infrastructure/nodes/hub';
import styles from './ConfigurationTab.module.css';

export interface KillswitchBannerProps {
  show: boolean;
  killswitchEntry: AppliedConfigEntry | undefined;
}

export function KillswitchBanner({ show, killswitchEntry }: KillswitchBannerProps) {
  const { t, i18n } = useTranslation();

  if (!(show && killswitchEntry?.override)) return null;

  return (
    <div className={styles.killswitchBanner} role="alert">
      <span className={styles.killswitchIcon} aria-hidden="true">{'⚠'}</span>
      <span>
        {t('pages:infrastructure.configuration.killswitchBypassBanner', {
          actor: killswitchEntry.override.setBy,
          when: new Date(killswitchEntry.override.setAt).toLocaleString(i18n.language),
        })}
      </span>
    </div>
  );
}
