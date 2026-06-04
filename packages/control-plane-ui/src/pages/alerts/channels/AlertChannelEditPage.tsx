/**
 * AlertChannelEditPage — create / edit a unified alert channel.
 *
 * Layout:
 *   - Breadcrumb + PageHeader (title swaps between "Create channel" and
 *     "Edit channel: <name>")
 *   - Card 1: common fields (name, type, enabled, severities, sourceTypes)
 *   - Card 2: per-type config panel (webhook | slack | email | pagerduty)
 *   - Footer: Save / Cancel
 *
 * Masked secrets:
 *   Hub redacts sensitive config values on GET with the literal prefix
 *   `xxxx-••••-<last4>`. On PUT, Hub's `mergeMaskedSecrets` restores any
 *   value the UI forwards verbatim. The UI therefore:
 *     - Renders masked fields read-only with a "Change" button.
 *     - Clicking "Change" clears the input and lets the user type a new
 *       secret. Saving sends the new value; Hub stores it plainly.
 *     - If the user never touches the field, the masked token is PUT back
 *       as-is and Hub substitutes the original.
 *
 * Route params: `/alerts/channels/:id` where `id === 'new'` means create.
 */
import { useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApi } from '@/hooks/useApi';
import { useMutation } from '@/hooks/useMutation';
import { alertsApi } from '@/api/services';
import type { AlertChannel, AlertSeverity } from '@/api/services';
import {
  PageHeader,
  Breadcrumb,
  Button,
  Stack,
  Card,
  Skeleton,
  ErrorBanner,
  Switch,
  Select,
  Input,
  FormField,
  MultiSelectDropdown,
} from '@/components/ui';
import { CHANNEL_TYPES, SEVERITIES, SOURCE_TYPES } from './channelMasking';
import { useChannelForm } from './useChannelForm';
import { WebhookConfig } from './WebhookConfig';
import { SlackConfig } from './SlackConfig';
import { EmailConfig } from './EmailConfig';
import { PagerDutyConfig } from './PagerDutyConfig';
import styles from './AlertChannelEditPage.module.css';

export { MASK_PREFIX } from './channelMasking';

export function AlertChannelEditPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const id = rawId ?? '';
  const isNew = id === 'new' || id === '';
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data: channel, loading, error, refetch } = useApi<AlertChannel>(
    () => alertsApi.getChannel(id),
    ['admin', 'alerts', 'channels', 'detail', id],
    { skip: isNew },
  );

  const form = useChannelForm(channel, isNew);
  const {
    name,
    setName,
    type,
    setType,
    enabled,
    setEnabled,
    severities,
    setSeverities,
    sourceTypes,
    setSourceTypes,
    webhookUrl,
    setWebhookUrl,
    headers,
    setHeaders,
    slackWebhookUrl,
    setSlackWebhookUrl,
    slackBotToken,
    setSlackBotToken,
    slackBotTokenMasked,
    setSlackBotTokenMasked,
    slackChannel,
    setSlackChannel,
    smtpHost,
    setSmtpHost,
    smtpPort,
    setSmtpPort,
    smtpFrom,
    setSmtpFrom,
    smtpTo,
    setSmtpTo,
    smtpUsername,
    setSmtpUsername,
    smtpPassword,
    setSmtpPassword,
    smtpPasswordMasked,
    setSmtpPasswordMasked,
    routingKey,
    setRoutingKey,
    routingKeyMasked,
    setRoutingKeyMasked,
    buildConfig,
  } = form;

  /* ── Mutations ─────────────────────────────────────────────────────────── */
  const { mutate: saveChannel, loading: saving } = useMutation<void, AlertChannel>(
    () => {
      const body = {
        name: name.trim(),
        type,
        enabled,
        severities,
        sourceTypes,
        config: buildConfig(),
      };
      if (isNew) return alertsApi.createChannel(body);
      return alertsApi.updateChannel(id, body);
    },
    {
      onSuccess: () => {
        navigate('/alerts/channels');
      },
      successMessage: isNew
        ? t('pages:alerts.channels.edit.createSuccess')
        : t('pages:alerts.channels.edit.saveSuccess'),
    },
  );

  const onSave = useCallback(() => {
    void saveChannel();
  }, [saveChannel]);
  const onCancel = useCallback(() => navigate('/alerts/channels'), [navigate]);

  /* ── Options for selects ───────────────────────────────────────────────── */
  const typeOptions = useMemo(
    () =>
      CHANNEL_TYPES.map((v) => ({
        value: v,
        label: t(`pages:alerts.channels.types.${v}`),
      })),
    [t],
  );

  const severityOptions = useMemo(
    () =>
      SEVERITIES.map((v) => ({
        value: v,
        label: t(`pages:alerts.channels.severities.${v}`),
      })),
    [t],
  );

  const sourceTypeOptions = useMemo(
    () => SOURCE_TYPES.map((v) => ({ value: v, label: v })),
    [],
  );

  if (!isNew && loading && !channel) return <Skeleton.DetailPageSkeleton />;
  if (!isNew && error) return <ErrorBanner message={error.message} onRetry={refetch} />;

  const title = isNew
    ? t('pages:alerts.channels.edit.createTitle')
    : t('pages:alerts.channels.edit.editTitle', { name: channel?.name ?? '' });

  return (
    <Stack gap="md">
      <Breadcrumb
        items={[
          { label: t('pages:alerts.channels.title'), to: '/alerts/channels' },
          { label: isNew ? t('pages:alerts.channels.edit.createTitle') : channel?.name ?? '' },
        ]}
      />

      <PageHeader
        title={title}
        subtitle={t('pages:alerts.channels.edit.subtitle')}
      />

      {/* Common fields */}
      <Card>
        <h3 className={styles.sectionTitle}>
          {t('pages:alerts.channels.edit.generalSection')}
        </h3>
        <Stack gap="md">
          <FormField label={t('pages:alerts.channels.edit.nameLabel')}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('pages:alerts.channels.edit.namePlaceholder')}
            />
          </FormField>
          <FormField label={t('pages:alerts.channels.edit.typeLabel')}>
            <Select
              value={type}
              onValueChange={(v) => setType(v as AlertChannel['type'])}
              options={typeOptions}
            />
          </FormField>
          <div className={styles.switchRow}>
            <label>{t('pages:alerts.channels.edit.enabledLabel')}</label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <MultiSelectDropdown
            label={t('pages:alerts.channels.edit.severitiesLabel')}
            emptyLabel={t('pages:alerts.channels.edit.severitiesAll')}
            options={severityOptions}
            value={severities}
            onChange={(next) => setSeverities(next as AlertSeverity[])}
          />
          <MultiSelectDropdown
            label={t('pages:alerts.channels.edit.sourceTypesLabel')}
            emptyLabel={t('pages:alerts.channels.edit.sourceTypesAll')}
            options={sourceTypeOptions}
            value={sourceTypes}
            onChange={setSourceTypes}
          />
          <p className={styles.hint}>
            {t('pages:alerts.channels.edit.sourceTypesHelp')}
          </p>
        </Stack>
      </Card>

      {/* Per-type config panel */}
      <Card>
        <h3 className={styles.sectionTitle}>
          {t(`pages:alerts.channelEditors.${type}.sectionTitle`)}
        </h3>

        {type === 'webhook' && (
          <WebhookConfig
            webhookUrl={webhookUrl}
            setWebhookUrl={setWebhookUrl}
            headers={headers}
            setHeaders={setHeaders}
          />
        )}

        {type === 'slack' && (
          <SlackConfig
            slackWebhookUrl={slackWebhookUrl}
            setSlackWebhookUrl={setSlackWebhookUrl}
            slackBotToken={slackBotToken}
            setSlackBotToken={setSlackBotToken}
            slackBotTokenMasked={slackBotTokenMasked}
            setSlackBotTokenMasked={setSlackBotTokenMasked}
            slackChannel={slackChannel}
            setSlackChannel={setSlackChannel}
          />
        )}

        {type === 'email' && (
          <EmailConfig
            smtpHost={smtpHost}
            setSmtpHost={setSmtpHost}
            smtpPort={smtpPort}
            setSmtpPort={setSmtpPort}
            smtpFrom={smtpFrom}
            setSmtpFrom={setSmtpFrom}
            smtpTo={smtpTo}
            setSmtpTo={setSmtpTo}
            smtpUsername={smtpUsername}
            setSmtpUsername={setSmtpUsername}
            smtpPassword={smtpPassword}
            setSmtpPassword={setSmtpPassword}
            smtpPasswordMasked={smtpPasswordMasked}
            setSmtpPasswordMasked={setSmtpPasswordMasked}
          />
        )}

        {type === 'pagerduty' && (
          <PagerDutyConfig
            routingKey={routingKey}
            setRoutingKey={setRoutingKey}
            routingKeyMasked={routingKeyMasked}
            setRoutingKeyMasked={setRoutingKeyMasked}
          />
        )}
      </Card>

      {/* Footer */}
      <Stack direction="horizontal" gap="sm" className={styles.footerActions}>
        <Button variant="secondary" onClick={onCancel}>
          {t('common:cancel')}
        </Button>
        <Button onClick={onSave} disabled={saving} loading={saving}>
          {t('common:save')}
        </Button>
      </Stack>
    </Stack>
  );
}
