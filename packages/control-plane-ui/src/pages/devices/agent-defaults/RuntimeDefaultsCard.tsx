import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Stack, Switch, Input, Select, FormField } from '@/components/ui';
import styles from './SettingsAgentTab.module.css';

interface RuntimeDefaultsCardProps {
  heartbeat: string;
  setHeartbeat: Dispatch<SetStateAction<string>>;
  auditDrain: string;
  setAuditDrain: Dispatch<SetStateAction<string>>;
  configSync: string;
  setConfigSync: Dispatch<SetStateAction<string>>;
  auditBatch: string;
  setAuditBatch: Dispatch<SetStateAction<string>>;
  logLevel: string;
  setLogLevel: Dispatch<SetStateAction<string>>;
  autoUpdateChannel: string;
  setAutoUpdateChannel: Dispatch<SetStateAction<string>>;
  trafficUploadLevel: string;
  setTrafficUploadLevel: Dispatch<SetStateAction<string>>;
  themeId: string;
  setThemeId: Dispatch<SetStateAction<string>>;
  autoUpdateEnabled: boolean;
  setAutoUpdateEnabled: Dispatch<SetStateAction<boolean>>;
  setDirty: Dispatch<SetStateAction<boolean>>;
  loading: boolean;
}

export function RuntimeDefaultsCard({
  heartbeat,
  setHeartbeat,
  auditDrain,
  setAuditDrain,
  configSync,
  setConfigSync,
  auditBatch,
  setAuditBatch,
  logLevel,
  setLogLevel,
  autoUpdateChannel,
  setAutoUpdateChannel,
  trafficUploadLevel,
  setTrafficUploadLevel,
  themeId,
  setThemeId,
  autoUpdateEnabled,
  setAutoUpdateEnabled,
  setDirty,
  loading,
}: RuntimeDefaultsCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <Stack gap="md">
        <h3 style={{ margin: 'var(--g-space-0)' }}>{t('pages:settings.agentRuntimeTitle', 'Runtime defaults')}</h3>
        <p className={styles.helpTextSecondary}>
          {t('pages:settings.agentRuntimeDesc', 'Fleet-wide reporting cadence, updater channel, and log level. Leave a field empty to fall back to the agent\'s YAML default.')}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--g-space-3)' }}>
          <FormField label={t('pages:settings.heartbeatIntervalSec')}>
            <Input
              type="number"
              value={heartbeat}
              onChange={(e) => { setHeartbeat(e.target.value); setDirty(true); }}
              placeholder="60"
              min={10}
              max={86400}
            />
          </FormField>
          <FormField label={t('pages:settings.auditDrainIntervalSec')}>
            <Input
              type="number"
              value={auditDrain}
              onChange={(e) => { setAuditDrain(e.target.value); setDirty(true); }}
              placeholder="30"
              min={10}
              max={86400}
            />
          </FormField>
          <FormField label={t('pages:settings.configSyncIntervalSec')}>
            <Input
              type="number"
              value={configSync}
              onChange={(e) => { setConfigSync(e.target.value); setDirty(true); }}
              placeholder="300"
              min={10}
              max={86400}
            />
          </FormField>
          <FormField label={t('pages:settings.auditBatchSize')}>
            <Input
              type="number"
              value={auditBatch}
              onChange={(e) => { setAuditBatch(e.target.value); setDirty(true); }}
              placeholder="100"
              min={1}
              max={10000}
            />
          </FormField>
          <FormField label={t('pages:settings.logLevel')}>
            <Select
              value={logLevel}
              onValueChange={(v) => { setLogLevel(v); setDirty(true); }}
              options={[
                { value: 'debug', label: 'debug' },
                { value: 'info', label: 'info' },
                { value: 'warn', label: 'warn' },
                { value: 'error', label: 'error' },
              ]}
            />
          </FormField>
          <FormField label={t('pages:settings.autoUpdateChannel')}>
            <Select
              value={autoUpdateChannel}
              onValueChange={(v) => { setAutoUpdateChannel(v); setDirty(true); }}
              options={[
                { value: 'stable', label: 'stable' },
                { value: 'beta', label: 'beta' },
              ]}
            />
          </FormField>
          <FormField
            label={t('pages:settings.trafficUploadLevel.label', 'Traffic upload level')}
            helpText={
              trafficUploadLevel === 'all'
                ? t('pages:settings.trafficUploadLevel.helpAll', 'Every captured flow is uploaded — including untracked hosts and inspect-but-passthrough rows. Highest cost; useful for audit windows.')
                : trafficUploadLevel === 'blocked'
                  ? t('pages:settings.trafficUploadLevel.helpBlocked', 'Only blocked / denied / bump-failed flows reach Hub. Silent operation; compliance evidence preserved.')
                  : t('pages:settings.trafficUploadLevel.helpProcessed', 'Processed (hooks ran), Blocked, and Bump-failed flows reach Hub. Untracked hosts and Inspect-only rows (matched but admin set passthrough) stay local. Recommended for production.')
            }
          >
            <Select
              value={trafficUploadLevel}
              onValueChange={(v) => { setTrafficUploadLevel(v); setDirty(true); }}
              options={[
                { value: 'all', label: t('pages:settings.trafficUploadLevel.optAll', 'All flows') },
                { value: 'processed', label: t('pages:settings.trafficUploadLevel.optProcessed', 'Processed / Blocked / Bump-failed (recommended)') },
                { value: 'blocked', label: t('pages:settings.trafficUploadLevel.optBlocked', 'Blocked / Bump-failed only') },
              ]}
            />
          </FormField>
          <FormField
            label={t('pages:settings.agentThemeId.label', 'Agent Dashboard theme')}
            helpText={t(
              'pages:settings.agentThemeId.help',
              'Forces every agent Dashboard in the fleet to render with this theme pack. Empty means each user keeps their own local pick. Unknown IDs fall back to the bundled default theme.',
            )}
          >
            <Select
              value={themeId}
              onValueChange={(v) => { setThemeId(v); setDirty(true); }}
              options={[
                { value: '', label: t('pages:settings.agentThemeId.optUserPick', 'Let each user choose (no fleet override)') },
                { value: 'default', label: t('pages:settings.agentThemeId.optDefault', 'Default (monochrome, Geist)') },
                { value: 'morningstar', label: 'Morningstar' },
                { value: 'rbc', label: 'RBC' },
              ]}
            />
          </FormField>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--g-space-3)', cursor: 'pointer' }}>
          <Switch
            checked={autoUpdateEnabled}
            onCheckedChange={(next) => { setAutoUpdateEnabled(next); setDirty(true); }}
            disabled={loading}
          />
          <div style={{ fontWeight: 'var(--g-font-weight-medium)' }}>
            {t('pages:settings.autoUpdateEnabledLabel', 'Auto-install signed updates')}
          </div>
        </label>
      </Stack>
    </Card>
  );
}
