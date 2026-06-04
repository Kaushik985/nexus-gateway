import type { AdminModelsByProvider } from '@/api/types';
import styles from './RoutingRuleCreate.module.css';

export function CreatePolicyProviderCheckboxes({
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
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter(x => x !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div className={styles.fieldGroup}>
      <label className={styles.fieldLabel}>{label}</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--g-space-2) var(--g-space-4)', marginTop: 'var(--g-space-1)' }}>
        {providerGroups
          .filter(g => g.provider?.enabled)
          .map(g => (
            <label key={g.provider?.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--g-space-1)', fontSize: 'var(--g-font-size-sm)' }}>
              <input
                type="checkbox"
                checked={selected.includes(g.provider?.id)}
                onChange={() => toggle(g.provider?.id)}
              />
              {g.provider?.displayName?.trim() || g.provider?.name}
            </label>
          ))}
      </div>
    </div>
  );
}
