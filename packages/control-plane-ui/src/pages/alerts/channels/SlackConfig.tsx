import { useTranslation } from 'react-i18next';
import { Button, Stack, Input, FormField } from '@/components/ui';
import styles from './AlertChannelEditPage.module.css';

interface SlackConfigProps {
  slackWebhookUrl: string;
  setSlackWebhookUrl: (v: string) => void;
  slackBotToken: string;
  setSlackBotToken: (v: string) => void;
  slackBotTokenMasked: boolean;
  setSlackBotTokenMasked: (v: boolean) => void;
  slackChannel: string;
  setSlackChannel: (v: string) => void;
}

export function SlackConfig({
  slackWebhookUrl,
  setSlackWebhookUrl,
  slackBotToken,
  setSlackBotToken,
  slackBotTokenMasked,
  setSlackBotTokenMasked,
  slackChannel,
  setSlackChannel,
}: SlackConfigProps) {
  const { t } = useTranslation();
  return (
    <Stack gap="md">
      <p className={styles.hint}>
        {t('pages:alerts.channelEditors.slack.modeHelp')}
      </p>
      <FormField
        label={t('pages:alerts.channelEditors.slack.webhookUrlLabel')}
        helpText={t('pages:alerts.channelEditors.slack.webhookUrlHelp')}
      >
        <Input
          type="url"
          value={slackWebhookUrl}
          onChange={(e) => setSlackWebhookUrl(e.target.value)}
          placeholder="https://hooks.slack.com/services/…"
        />
      </FormField>
      <FormField label={t('pages:alerts.channelEditors.slack.botTokenLabel')}>
        <div className={styles.secretRow}>
          <Input
            type={slackBotTokenMasked ? 'text' : 'password'}
            value={slackBotToken}
            readOnly={slackBotTokenMasked}
            onChange={(e) => setSlackBotToken(e.target.value)}
            placeholder={t('pages:alerts.slackTokenPlaceholder')}
          />
          {slackBotTokenMasked && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setSlackBotToken('');
                setSlackBotTokenMasked(false);
              }}
            >
              {t('pages:alerts.channels.edit.changeSecret')}
            </Button>
          )}
        </div>
      </FormField>
      <FormField label={t('pages:alerts.channelEditors.slack.channelLabel')}>
        <Input
          value={slackChannel}
          onChange={(e) => setSlackChannel(e.target.value)}
          placeholder="#alerts"
        />
      </FormField>
    </Stack>
  );
}
