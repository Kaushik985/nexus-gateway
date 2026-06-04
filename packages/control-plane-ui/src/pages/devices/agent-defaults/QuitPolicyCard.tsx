import { useTranslation } from 'react-i18next';
import { Card, Stack, Switch } from '@/components/ui';
import styles from './SettingsAgentTab.module.css';

interface QuitPolicyCardProps {
  quitAllowed: boolean;
  onQuitToggle: (next: boolean) => void;
  loading: boolean;
}

export function QuitPolicyCard({ quitAllowed, onQuitToggle, loading }: QuitPolicyCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <Stack gap="md">
        <h3 style={{ margin: 'var(--g-space-0)' }}>{t('pages:settings.quitPolicyTitle', 'Agent Quit Policy')}</h3>
        <p className={styles.helpTextSecondary}>
          {t('pages:settings.quitPolicyDesc', 'Controls whether the agent menu bar exposes Restart Agent and Quit Nexus Agent items. Turn off for compliance always-on deployments — users cannot quit the agent process.')}
        </p>

        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--g-space-3)', cursor: 'pointer' }}>
          <Switch
            checked={quitAllowed}
            onCheckedChange={onQuitToggle}
            disabled={loading}
          />
          <div>
            <div style={{ fontWeight: 'var(--g-font-weight-medium)' }}>
              {t('pages:settings.quitAllowedLabel', 'Allow users to quit the agent')}
            </div>
            <div className={styles.hintTextMuted}>
              {quitAllowed
                ? t('pages:settings.quitAllowedOnHint', 'Restart Agent and Quit Nexus Agent menu items are visible.')
                : t('pages:settings.quitAllowedOffHint', 'Restart Agent and Quit Nexus Agent menu items are hidden — only Restart App is available.')}
            </div>
          </div>
        </label>
      </Stack>
    </Card>
  );
}
