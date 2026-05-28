import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge, statusToVariant, Button, Stack, Card,
} from '@/components/ui';
import { providerApi } from '@/api/services';
import { FormInput, FormSelect, FormSwitch } from '@/lib/forms';
import { ProviderConnectivityTestButton } from '../list/ProviderConnectivityTestButton';
import { PROVIDER_ADAPTER_TYPES } from '../_shared/adapterTypes';
import type { ProviderDetailState } from './useProviderDetail';
import { fmtDate } from './useProviderDetail';
import styles from './ProviderDetail.module.css';

interface ProviderInfoTabProps {
  detail: ProviderDetailState;
}

export function ProviderInfoTab({ detail }: ProviderInfoTabProps) {
  const { t } = useTranslation();
  const {
    provider, canUpdate,
    isEditing, setIsEditing,
    providerForm,
    handleSave, saveLoading,
    credentials,
  } = detail;

  const editName = providerForm.watch('name');
  const editBaseUrl = providerForm.watch('baseUrl');

  // Pre-check the provider name for uniqueness while editing (excluding this
  // provider's own current name), so a rename collision surfaces inline rather
  // than as a PROVIDER_NAME_EXISTS 409 on Save. Mirrors the create wizard's
  // debounced check; backend stays the final guard.
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameChecking, setNameChecking] = useState(false);
  const nameSeqRef = useRef(0);
  useEffect(() => {
    if (!isEditing || !provider) { setNameError(null); setNameChecking(false); return; }
    const trimmed = (editName ?? '').trim();
    if (!trimmed || trimmed.toLowerCase() === provider.name.toLowerCase()) {
      setNameError(null); setNameChecking(false); return;
    }
    const seq = ++nameSeqRef.current;
    setNameChecking(true);
    const handle = setTimeout(async () => {
      try {
        const res = await providerApi.list({ q: trimmed, limit: 50 });
        if (seq !== nameSeqRef.current) return; // stale
        const hit = (res.data ?? []).some(
          (p) => p.name.toLowerCase() === trimmed.toLowerCase() && p.id !== provider.id,
        );
        setNameError(hit ? t('pages:providers.nameAlreadyExists') : null);
      } catch {
        if (seq === nameSeqRef.current) setNameError(null); // backend is the final guard
      } finally {
        if (seq === nameSeqRef.current) setNameChecking(false);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [isEditing, editName, provider, t]);

  if (!provider) return null;

  return (
    <Card>
      {isEditing ? (
        <Stack gap="md">
          <FormInput form={providerForm} name="name" label={t('pages:providers.name')} required />
          {nameError && (
            <div style={{ color: 'var(--color-danger)', fontSize: 'var(--g-font-size-xs)' }}>{nameError}</div>
          )}
          <FormInput form={providerForm} name="displayName" label={t('pages:providers.displayName')} />
          <FormInput form={providerForm} name="description" label={t('pages:providers.description')} />
          <FormInput form={providerForm} name="baseUrl" label={t('pages:providers.baseUrl')} required type="url" placeholder={t('pages:providers.placeholderBaseUrl')} />
          <FormSelect
            form={providerForm}
            name="adapterType"
            label={t('pages:providers.adapter')}
            required
            helpText={t('pages:providers.adapterHelp')}
            options={PROVIDER_ADAPTER_TYPES.map((v) => ({
              value: v,
              label: t(`pages:providers.adapterOption_${v}`),
            }))}
          />
          <FormInput
            form={providerForm}
            name="region"
            label={t('pages:providers.region')}
            placeholder={t('pages:providers.regionPlaceholder')}
            helpText={t('pages:providers.regionHelp')}
          />
          <FormInput
            form={providerForm}
            name="apiVersion"
            label={t('pages:providers.apiVersion')}
            placeholder={t('pages:providers.apiVersionPlaceholder')}
            helpText={t('pages:providers.apiVersionHelp')}
          />
          <FormSwitch form={providerForm} name="enabled" label={t('common:enabled')} />
          <Stack direction="horizontal" gap="sm" className={styles.justifyEnd}>
            <Button variant="secondary" onClick={() => setIsEditing(false)}>{t('common:cancel')}</Button>
            <Button onClick={handleSave} disabled={saveLoading || !editName || !editBaseUrl || !!nameError || nameChecking}>
              {saveLoading ? t('pages:providers.saving') : t('common:save')}
            </Button>
          </Stack>
        </Stack>
      ) : (
        <>
          <div className={styles.kvGrid}>
            <div>
              <div className={styles.kvLabel}>{t('pages:providers.adapter')}</div>
              <div className={styles.kvValue}>
                {t(`pages:providers.adapterOption_${provider.adapterType}`, provider.adapterType)}
              </div>
            </div>
            <div><div className={styles.kvLabel}>{t('pages:providers.baseUrl')}</div><div className={styles.kvValueMono}>{provider.baseUrl}</div></div>
            <div><div className={styles.kvLabel}>{t('pages:providers.status')}</div><div className={styles.mt2}><Badge variant={statusToVariant(provider.enabled ? 'enabled' : 'disabled')}>{provider.enabled ? t('common:enabled') : t('common:disabled')}</Badge></div></div>
            <div><div className={styles.kvLabel}>{t('pages:providers.created')}</div><div className={styles.kvValue}>{fmtDate(provider.createdAt)}</div></div>
            {provider.region && (
              <div><div className={styles.kvLabel}>{t('pages:providers.region')}</div><div className={styles.kvValue}>{provider.region}</div></div>
            )}
            {provider.apiVersion && (
              <div><div className={styles.kvLabel}>{t('pages:providers.apiVersion')}</div><div className={styles.kvValue}>{provider.apiVersion}</div></div>
            )}
            {provider.description && (
              <div className={styles.kvSpanFull}><div className={styles.kvLabel}>{t('pages:providers.description')}</div><div className={styles.kvValue}>{provider.description}</div></div>
            )}
          </div>
          {canUpdate && (
            <div className={styles.connectivitySection}>
              <div className={styles.kvLabelSmGap}>{t('pages:providers.upstreamReachability')}</div>
              <ProviderConnectivityTestButton variant="existing" providerId={provider.id} credentials={credentials} />
            </div>
          )}
        </>
      )}
    </Card>
  );
}
