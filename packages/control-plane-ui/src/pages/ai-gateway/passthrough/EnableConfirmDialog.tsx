import { useTranslation } from 'react-i18next';
import { Button, Stack, Dialog } from '@/components/ui';
import type { PassthroughTier } from '@/api/services';
import { bypassSummary, type TierKind, type TierFormState } from './passthroughForm';
import styles from './PassthroughPage.module.css';

export function EnableConfirmDialog({
  open, onClose, onConfirm, scope, scopeKey, form,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  scope: TierKind;
  scopeKey: string;
  form: TierFormState;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }} title={t('pages:passthrough.confirm.title')}>
      <Stack gap="md">
        <p className={styles.confirmBody}>{t('pages:passthrough.confirm.body')}</p>
        <ul className={styles.confirmList}>
          <li>{t('pages:passthrough.confirm.scope', { scope, scopeKey })}</li>
          <li>{t('pages:passthrough.confirm.flags', { flags: bypassSummary(form as unknown as PassthroughTier) || t('pages:passthrough.confirm.flagsNone') })}</li>
          <li>{t('pages:passthrough.confirm.expires', { expires: form.expiresAt ? new Date(form.expiresAt).toLocaleString() : '?' })}</li>
          <li>{t('pages:passthrough.confirm.reason', { reason: form.reason })}</li>
        </ul>
        <Stack direction="horizontal" gap="sm" justify="end">
          <Button variant="secondary" onClick={onClose}>{t('common:cancel')}</Button>
          <Button variant="danger" onClick={onConfirm}>{t('pages:passthrough.confirm.confirmBtn')}</Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}
