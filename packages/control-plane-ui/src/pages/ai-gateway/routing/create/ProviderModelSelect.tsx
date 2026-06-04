import { useTranslation } from 'react-i18next';
import type { AdminModelsByProvider } from '@/api/types';
import styles from './RoutingRuleCreate.module.css';

/** Provider+Model cascading selector */
export function ProviderModelSelect({
  providerValue,
  modelValue,
  onProviderChange,
  onModelChange,
  providerGroups,
  className,
}: {
  providerValue: string;
  modelValue: string;
  onProviderChange: (v: string) => void;
  onModelChange: (v: string) => void;
  providerGroups: AdminModelsByProvider[];
  className?: string;
}) {
  const { t } = useTranslation();
  const modelsForProvider = providerGroups.find(g => g.provider?.name === providerValue)?.models ?? [];

  return (
    <div className={`${styles.providerModelRow} ${className ?? ''}`}>
      <select
        value={providerValue}
        onChange={e => {
          onProviderChange(e.target.value);
          onModelChange('');
        }}
        className={styles.selectInput}
      >
        <option value="">{t('pages:routing.selectProvider')}</option>
        {providerGroups.map(g => (
          <option key={g.provider?.id} value={g.provider?.name}>
            {g.provider?.displayName?.trim() || g.provider?.name} ({g?.models?.length})
          </option>
        ))}
      </select>
      <select
        value={modelValue}
        onChange={e => onModelChange(e.target.value)}
        className={styles.selectInput}
        disabled={!providerValue}
      >
        <option value="">{providerValue ? t('pages:routing.selectModel') : t('pages:routing.selectProviderFirst')}</option>
        {modelsForProvider.map(m => (
          <option key={m.id} value={m.providerModelId}>
            {m.name} ({m.providerModelId})
          </option>
        ))}
      </select>
    </div>
  );
}
