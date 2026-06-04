import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AdminModelsByProvider } from '@/api/types';
import styles from './RoutingRuleCreate.module.css';
import { IconButton } from "@nexus-gateway/ui-shared";

/** Model selector for Match Conditions — excludes models already used in Configuration */
export function MatchModelSelector({
  selected,
  onChange,
  providerGroups,
  excludeModels,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
  providerGroups: AdminModelsByProvider[];
  excludeModels: Set<string>;
}) {
  const { t } = useTranslation();
  const handleAdd = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val && !selected.includes(val)) {
      onChange([...selected, val]);
    }
    e.target.value = '';
  };

  const handleRemove = (model: string) => {
    onChange(selected.filter(m => m !== model));
  };

  const labelMap = new Map<string, string>();
  for (const g of providerGroups) {
    for (const m of g.models) {
      labelMap.set(m.id, `${g.provider?.displayName?.trim() || g.provider?.name} / ${m.name}`);
    }
  }

  return (
    <div>
      <div className={`${styles.tagContainer} ${selected.length === 0 ? styles.tagContainerHidden : styles.tagContainerVisible}`}>
        {selected.map(modelId => (
          <span key={modelId} className={styles.tag}>
            {labelMap.get(modelId) ?? modelId}
            <IconButton size="sm" aria-label={t('pages:routing.removeAria')} onClick={() => handleRemove(modelId)}>×</IconButton>
          </span>
        ))}
      </div>
      <select onChange={handleAdd} value="" className={styles.selectInputFull}>
        <option value="">{t('pages:routing.addModelToMatch')}</option>
        {providerGroups.map(g => {
          const available = g?.models?.filter(m => !selected.includes(m.id) && !excludeModels.has(m.id));
          if (available.length === 0) return null;
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
