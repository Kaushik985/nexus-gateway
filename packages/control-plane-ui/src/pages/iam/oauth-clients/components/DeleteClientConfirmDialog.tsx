import { useState, useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, Stack, Button, Input, FormField } from '@/components/ui';
import styles from './DeleteClientConfirmDialog.module.css';

export interface DeleteClientConfirmDialogProps {
  open: boolean;
  clientId: string;
  /** Live refresh-token count surfaced in the body so the admin sees the blast radius. */
  activeRefreshTokenCount: number;
  /** Disabled state for the Delete button (e.g. while the mutation is in flight). */
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Type-to-confirm destructive dialog for OAuth client deletion. The Delete
 * button stays disabled until the input value exactly matches the client id;
 * the body surfaces the live activeRefreshTokenCount so the admin understands
 * the cascade blast radius (the FK constraint deletes those rows on commit).
 */
export function DeleteClientConfirmDialog({
  open,
  clientId,
  activeRefreshTokenCount,
  loading = false,
  onCancel,
  onConfirm,
}: DeleteClientConfirmDialogProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  const matches = typed === clientId;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o) onCancel(); }}
      title={t('pages:iam.oauthClients.deleteConfirmTitle')}
      size="sm"
    >
      <Stack gap="md">
        <p className={styles.body}>
          {t('pages:iam.oauthClients.deleteConfirmBody', {
            count: activeRefreshTokenCount,
            clientId,
          })}
        </p>
        <FormField
          label={t('pages:iam.oauthClients.deleteConfirmInputLabel', { clientId })}
        >
          <Input
            id={inputId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label={t('pages:iam.oauthClients.deleteConfirmInputLabel', { clientId })}
          />
        </FormField>
        <Stack direction="horizontal" gap="sm" className={styles.actions}>
          <Button variant="secondary" onClick={onCancel}>
            {t('pages:iam.oauthClients.deleteConfirmCancel')}
          </Button>
          <Button
            variant="danger"
            disabled={!matches || loading}
            onClick={onConfirm}
          >
            {t('pages:iam.oauthClients.deleteConfirmDelete')}
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}
