import { useTranslation } from 'react-i18next';
import { Button, Stack, Switch, Textarea } from '@/components/ui';
import styles from './AIGatewaySimulatorPage.module.css';

interface ComposerProps {
  inputText: string;
  setInputText: (text: string) => void;
  stream: boolean;
  setStream: (stream: boolean) => void;
  sending: boolean;
  canSend: boolean | string;
  onSend: () => void;
  stopStreaming: () => void;
}

export function Composer({
  inputText,
  setInputText,
  stream,
  setStream,
  sending,
  canSend,
  onSend,
  stopStreaming,
}: ComposerProps) {
  const { t } = useTranslation();

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void onSend();
    }
  };

  return (
    <div className={styles.composer}>
      <Textarea
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
        onKeyDown={onComposerKeyDown}
        placeholder={t('pages:aiGatewaySimulator.inputPlaceholder')}
        rows={3}
        className={styles.composerTextarea}
        aria-label={t('pages:aiGatewaySimulator.chatInputAria', 'chat input')}
      />
      <div className={styles.composerActions}>
        <Stack direction="horizontal" gap="sm" align="center">
          <Switch
            checked={stream}
            onCheckedChange={setStream}
            aria-label={t('pages:aiGatewaySimulator.streamMode')}
          />
          <span className={styles.streamLabel}>{t('pages:aiGatewaySimulator.streamMode')}</span>
        </Stack>
        <Stack direction="horizontal" gap="sm" align="center">
          {stream && sending ? (
            <Button variant="danger" onClick={stopStreaming}>
              {t('pages:aiGatewaySimulator.stop')}
            </Button>
          ) : null}
          <Button onClick={onSend} loading={sending} disabled={!canSend}>
            {t('pages:aiGatewaySimulator.send')}
          </Button>
        </Stack>
      </div>
    </div>
  );
}
