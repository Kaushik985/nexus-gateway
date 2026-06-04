import { useTranslation } from 'react-i18next';
import { Button, Dialog, FormField, Input, Stack } from '@/components/ui';
import styles from './AIGatewaySimulatorPage.module.css';

interface SettingsDialogProps {
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  vk: string;
  setVk: (vk: string) => void;
  loadModels: () => Promise<void>;
  loadingModels: boolean;
  canLoadModels: boolean;
}

export function SettingsDialog({
  settingsOpen,
  setSettingsOpen,
  vk,
  setVk,
  loadModels,
  loadingModels,
  canLoadModels,
}: SettingsDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={settingsOpen}
      onOpenChange={setSettingsOpen}
      title={t('pages:aiGatewaySimulator.settingsTitle', 'Connection settings')}
    >
      <Stack gap="md">
        <FormField label={t('pages:aiGatewaySimulator.vk')}>
          <Input
            id="ai-gateway-simulator-vk"
            type="password"
            value={vk}
            onChange={(e) => setVk(e.target.value)}
            placeholder={t('pages:simulator.vkPlaceholder')}
          />
        </FormField>

        <Stack direction="horizontal" gap="sm" justify="between" align="center">
          <Button onClick={loadModels} loading={loadingModels} disabled={!canLoadModels}>
            {t('pages:aiGatewaySimulator.loadModels')}
          </Button>
          <Button variant="secondary" onClick={() => setSettingsOpen(false)}>
            {t('pages:aiGatewaySimulator.closeSettings', 'Done')}
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}
