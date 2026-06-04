import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AdminModelsByProvider } from '@/api/types';
import styles from './RoutingRuleCreate.module.css';
import { IconButton } from "@nexus-gateway/ui-shared";

export function CreatePolicyModelSelect({
  selected,
  onChange,
  providerGroups,
  label,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
  providerGroups: AdminModelsByProvider[];
  label: string;
}) {
  const { t } = useTranslation();
  const handleAdd = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val && !selected.includes(val)) {
      onChange([...selected, val]);
    }
    e.target.value = '';
  };

  const handleRemove = (id: string) => {
    onChange(selected.filter(m => m !== id));
  };

  const labelMap = new Map<string, string>();
  for (const g of providerGroups) {
    for (const m of g.models) {
      labelMap.set(m.id, `${g.provider?.displayName?.trim() || g.provider?.name} / ${m.name}`);
    }
  }

  return (
    <div className={styles.fieldGroup}>
      <label className={styles.fieldLabel}>{label}</label>
      {selected.length > 0 && (
        <div className={`${styles.tagContainer} ${styles.tagContainerVisible}`}>
          {selected.map(id => (
            <span key={id} className={styles.tag}>
              {labelMap.get(id) ?? id}
              <IconButton size="sm" aria-label={t('pages:routing.removeAria')} onClick={() => handleRemove(id)}>×</IconButton>
            </span>
          ))}
        </div>
      )}
      <select onChange={handleAdd} value="" className={styles.selectInputFull}>
        <option value="">{t('pages:routing.addModelToPolicy')}</option>
        {providerGroups.map(g => {
          const available = g?.models?.filter(m => !selected.includes(m.id));
          if (!available || available.length === 0) return null;
          return (
            <optgroup key={g.provider?.id} label={g.provider?.displayName?.trim() || g.provider?.name}>
              {available.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.providerModelId})
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </div>
  );
}
