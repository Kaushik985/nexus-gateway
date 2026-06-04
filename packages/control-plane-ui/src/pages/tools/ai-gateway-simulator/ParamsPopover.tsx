import { useTranslation } from 'react-i18next';
import {
  Button,
  Checkbox,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui';
import {
  type CustomParam,
  type ParamRowState,
  type StandardParamKey,
  STANDARD_PARAM_META,
  STANDARD_PARAM_ORDER,
} from './simulatorParams';
import styles from './AIGatewaySimulatorPage.module.css';

interface ParamsPopoverProps {
  paramsOpen: boolean;
  setParamsOpen: (open: boolean) => void;
  activeParamCount: number;
  stdParams: Record<StandardParamKey, ParamRowState>;
  customParams: CustomParam[];
  setStdParam: (key: StandardParamKey, patch: Partial<ParamRowState>) => void;
  updateCustomParam: (id: string, patch: Partial<CustomParam>) => void;
  addCustomParam: () => void;
  removeCustomParam: (id: string) => void;
  resetParams: () => void;
}

export function ParamsPopover({
  paramsOpen,
  setParamsOpen,
  activeParamCount,
  stdParams,
  customParams,
  setStdParam,
  updateCustomParam,
  addCustomParam,
  removeCustomParam,
  resetParams,
}: ParamsPopoverProps) {
  const { t } = useTranslation();

  return (
    <Popover open={paramsOpen} onOpenChange={setParamsOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary">
          {t('pages:aiGatewaySimulator.params', 'Params')} ({activeParamCount})
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6}>
        <div className={styles.paramsPanel}>
          <p className={styles.paramsSectionTitle}>
            {t('pages:aiGatewaySimulator.standardParams', 'Standard parameters')}
          </p>
          {STANDARD_PARAM_ORDER.map((key) => {
            const meta = STANDARD_PARAM_META[key];
            const row = stdParams[key];
            return (
              <div key={key} className={styles.paramRow}>
                <Checkbox
                  checked={row.enabled}
                  onCheckedChange={(c) => setStdParam(key, { enabled: Boolean(c) })}
                  aria-label={key}
                />
                <span className={styles.paramLabel}>{key}</span>
                <Input
                  value={row.value}
                  onChange={(e) => setStdParam(key, { value: e.target.value })}
                  placeholder={meta.defaultValue || ''}
                  type={meta.kind === 'text' ? 'text' : 'text'}
                  disabled={!row.enabled}
                />
              </div>
            );
          })}
          <p className={styles.paramsSectionTitle}>
            {t('pages:aiGatewaySimulator.customParams', 'Custom parameters')}
          </p>
          <p className={styles.paramsHint}>
            {t(
              'pages:aiGatewaySimulator.customParamsHint',
              'Values parse as JSON when possible (objects, numbers, booleans). Plain text passes through as a string. Custom keys override standard ones.',
            )}
          </p>
          {customParams.map((row) => (
            <div key={row.id} className={styles.customParamRow}>
              <Checkbox
                checked={row.enabled}
                onCheckedChange={(c) => updateCustomParam(row.id, { enabled: Boolean(c) })}
                aria-label={`custom ${row.key}`}
              />
              <Input
                value={row.key}
                onChange={(e) => updateCustomParam(row.id, { key: e.target.value })}
                placeholder={t('pages:aiGatewaySimulator.customKey', 'key')}
              />
              <Input
                value={row.value}
                onChange={(e) => updateCustomParam(row.id, { value: e.target.value })}
                placeholder={t('pages:aiGatewaySimulator.customValue', 'value or JSON')}
              />
              <button
                type="button"
                className={styles.deleteCustomParam}
                onClick={() => removeCustomParam(row.id)}
                aria-label={t('pages:aiGatewaySimulator.removeCustomParam', 'Remove')}
              >
                ×
              </button>
            </div>
          ))}
          <Button variant="secondary" onClick={addCustomParam}>
            + {t('pages:aiGatewaySimulator.addCustomParam', 'Add custom parameter')}
          </Button>
          <div className={styles.paramsFooter}>
            <Button variant="secondary" onClick={resetParams}>
              {t('pages:aiGatewaySimulator.resetParams', 'Reset')}
            </Button>
            <Button onClick={() => setParamsOpen(false)}>
              {t('pages:aiGatewaySimulator.doneParams', 'Done')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
