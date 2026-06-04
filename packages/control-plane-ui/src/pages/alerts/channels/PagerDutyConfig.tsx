import { useTranslation } from 'react-i18next';
import { Button, Stack, Input, FormField } from '@/components/ui';
import styles from './AlertChannelEditPage.module.css';

interface PagerDutyConfigProps {
  routingKey: string;
  setRoutingKey: (v: string) => void;
  routingKeyMasked: boolean;
  setRoutingKeyMasked: (v: boolean) => void;
}

export function PagerDutyConfig({
  routingKey,
  setRoutingKey,
  routingKeyMasked,
  setRoutingKeyMasked,
}: PagerDutyConfigProps) {
  const { t } = useTranslation();
  return (
    <Stack gap="md">
      <FormField
        label={t('pages:alerts.channelEditors.pagerduty.routingKeyLabel')}
        helpText={t('pages:alerts.channelEditors.pagerduty.routingKeyHelp')}
      >
        <div className={styles.secretRow}>
          <Input
            type={routingKeyMasked ? 'text' : 'password'}
            value={routingKey}
            readOnly={routingKeyMasked}
            onChange={(e) => setRoutingKey(e.target.value)}
            autoComplete="off"
          />
          {routingKeyMasked && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setRoutingKey('');
                setRoutingKeyMasked(false);
              }}
            >
              {t('pages:alerts.channels.edit.changeSecret')}
            </Button>
          )}
        </div>
      </FormField>
    </Stack>
  );
}
