import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '@/hooks/useApi';
import { useMutation } from '@/hooks/useMutation';
import { cacheApi, type CacheGlobalConfig } from '@/api/services/system/cache';
import { Button, Card, ErrorBanner, FormField, Skeleton, Stack, Switch } from '@/components/ui';
import styles from './SettingsCacheTab.module.css';

export function GlobalPanel() {
  const { t } = useTranslation();
  const [normaliserEnabled, setNormaliserEnabled] = useState(false);
  const [killSwitch, setKillSwitch] = useState(false);

  const { data, loading, error, refetch } = useApi<CacheGlobalConfig>(
    () => cacheApi.getGlobal(),
    ['admin', 'cache', 'global'],
  );

  useEffect(() => {
    if (!data) return;
    setNormaliserEnabled(!!data.normaliser_enabled);
    setKillSwitch(!!data.cache_master_kill_switch);
  }, [data]);

  const { mutate: save, loading: saving } = useMutation(
    () =>
      cacheApi.putGlobal({
        normaliser_enabled: normaliserEnabled,
        cache_master_kill_switch: killSwitch,
      }),
    {
      invalidateQueries: [['admin', 'cache', 'global']],
      onSuccess: () => refetch(),
      successMessage: t('pages:settings.promptCache.saved'),
      errorMessage: t('pages:settings.promptCache.saveError'),
    },
  );

  if (loading && !data) return <Skeleton.ListPageSkeleton />;
  if (error) return <ErrorBanner message={error.message} onRetry={refetch} />;

  return (
    <Card>
      <Stack gap="md">
        <h2 style={{ margin: 'var(--g-space-0)' }}>{t('pages:settings.promptCache.globalTitle')}</h2>
        <p className={styles.subtitle}>{t('pages:settings.promptCache.globalSubtitle')}</p>

        <FormField
          label={t('pages:settings.promptCache.normaliserEnabled')}
          helpText={t('pages:settings.promptCache.normaliserEnabledHint')}
        >
          <Switch checked={normaliserEnabled} onCheckedChange={setNormaliserEnabled} />
        </FormField>

        <FormField
          label={t('pages:settings.promptCache.killSwitch')}
          helpText={t('pages:settings.promptCache.killSwitchHint')}
        >
          <Switch checked={killSwitch} onCheckedChange={setKillSwitch} />
        </FormField>

        <Stack direction="horizontal" gap="sm">
          <Button onClick={() => save(undefined)} disabled={saving}>
            {saving ? t('common:saving') : t('common:save')}
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
}
