import { useTranslation } from 'react-i18next';
import { FormField, Select } from '@/components/ui';
import styles from './HookForm.module.css';

interface ImplementationSelectorProps {
  implSelectOptions: { value: string; label: string }[];
  selectedImplementationId: string;
  onImplementationChange: (id: string) => void;
}

export function ImplementationSelector({
  implSelectOptions,
  selectedImplementationId,
  onImplementationChange,
}: ImplementationSelectorProps) {
  const { t } = useTranslation();

  if (implSelectOptions.length > 0) {
    return (
      <FormField label={t('pages:hooks.implementationFieldLabel')} required helpText={t('pages:hooks.implementationFieldHelp')}>
        <Select
          value={selectedImplementationId || implSelectOptions[0]?.value || ''}
          onValueChange={onImplementationChange}
          options={implSelectOptions}
          placeholder={t('pages:hooks.selectImplementation')}
        />
      </FormField>
    );
  }

  return (
    <p className={styles.noImplementations}>
      {t('pages:hooks.noImplementationsMatch')}
    </p>
  );
}
