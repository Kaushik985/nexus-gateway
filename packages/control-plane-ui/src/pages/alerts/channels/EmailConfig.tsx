import { useTranslation } from 'react-i18next';
import { Button, Stack, Input, FormField } from '@/components/ui';
import styles from './AlertChannelEditPage.module.css';

interface EmailConfigProps {
  smtpHost: string;
  setSmtpHost: (v: string) => void;
  smtpPort: string;
  setSmtpPort: (v: string) => void;
  smtpFrom: string;
  setSmtpFrom: (v: string) => void;
  smtpTo: string;
  setSmtpTo: (v: string) => void;
  smtpUsername: string;
  setSmtpUsername: (v: string) => void;
  smtpPassword: string;
  setSmtpPassword: (v: string) => void;
  smtpPasswordMasked: boolean;
  setSmtpPasswordMasked: (v: boolean) => void;
}

export function EmailConfig({
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
}: EmailConfigProps) {
  const { t } = useTranslation();
  return (
    <Stack gap="md">
      <div className={styles.twoColumn}>
        <FormField label={t('pages:alerts.channelEditors.email.smtpHostLabel')}>
          <Input
            value={smtpHost}
            onChange={(e) => setSmtpHost(e.target.value)}
            placeholder="smtp.example.com"
          />
        </FormField>
        <FormField label={t('pages:alerts.channelEditors.email.smtpPortLabel')}>
          <Input
            type="number"
            value={smtpPort}
            onChange={(e) => setSmtpPort(e.target.value)}
            min={1}
            max={65535}
          />
        </FormField>
      </div>
      <div className={styles.twoColumn}>
        <FormField label={t('pages:alerts.channelEditors.email.fromLabel')}>
          <Input
            type="email"
            value={smtpFrom}
            onChange={(e) => setSmtpFrom(e.target.value)}
            placeholder="alerts@example.com"
          />
        </FormField>
        <FormField label={t('pages:alerts.channelEditors.email.toLabel')}>
          <Input
            type="email"
            value={smtpTo}
            onChange={(e) => setSmtpTo(e.target.value)}
            placeholder="oncall@example.com"
          />
        </FormField>
      </div>
      <div className={styles.twoColumn}>
        <FormField label={t('pages:alerts.channelEditors.email.usernameLabel')}>
          <Input
            value={smtpUsername}
            onChange={(e) => setSmtpUsername(e.target.value)}
            autoComplete="off"
          />
        </FormField>
        <FormField label={t('pages:alerts.channelEditors.email.passwordLabel')}>
          <div className={styles.secretRow}>
            <Input
              type={smtpPasswordMasked ? 'text' : 'password'}
              value={smtpPassword}
              readOnly={smtpPasswordMasked}
              onChange={(e) => setSmtpPassword(e.target.value)}
              autoComplete="new-password"
            />
            {smtpPasswordMasked && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSmtpPassword('');
                  setSmtpPasswordMasked(false);
                }}
              >
                {t('pages:alerts.channels.edit.changeSecret')}
              </Button>
            )}
          </div>
        </FormField>
      </div>
    </Stack>
  );
}
