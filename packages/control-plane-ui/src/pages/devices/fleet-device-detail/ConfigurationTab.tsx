import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui';
import styles from '../FleetDeviceDetailPage.module.css';

interface ConfigurationTabProps {
  configData: unknown;
}

export function ConfigurationTab({ configData }: ConfigurationTabProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <p className={styles.configNote}>{t('pages:fleet.effectiveConfig')}</p>
      <pre className={styles.configPre}>{JSON.stringify(configData ?? {}, null, 2)}</pre>
    </Card>
  );
}
