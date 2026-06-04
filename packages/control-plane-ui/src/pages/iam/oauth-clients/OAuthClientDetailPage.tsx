import { useState, useCallback } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { oauthClientApi, type OAuthClient, type OAuthClientRotateResponse } from '@/api/services';
import { useApi } from '@/hooks/useApi';
import { useMutation } from '@/hooks/useMutation';
import { usePermission } from '@/hooks/usePermission';
import { useToast } from '@/context/ToastContext';
import { formatRelativeTime } from '@/lib/format';
import {
  PageHeader, Breadcrumb, Stack, Card, Button, Skeleton, ErrorBanner,
  AlertDialog, SecretDialog, Tooltip,
} from '@/components/ui';
import { ScopeChip } from './components/ScopeChip';
import { DeleteClientConfirmDialog } from './components/DeleteClientConfirmDialog';
import styles from './OAuthClientDetailPage.module.css';

/**
 * Render a TTL second-count as a human-friendly localized string. The handler
 * accepts 60..86400 seconds for access TTLs and 3600..2592000 for refresh TTLs,
 * so the units we surface are minutes / hours / days. Uses i18next plural
 * forms so the EN "1 day / N days" / ES "1 día / N días" / ZH "1 天 / N 天"
 * variants stay together with the rest of the page copy.
 */
function useFormatSeconds(): (s: number) => string {
  const { t } = useTranslation();
  return (s: number) => {
    if (s % 86400 === 0) return t('pages:iam.oauthClients.duration.day', { count: s / 86400 });
    if (s % 3600 === 0) return t('pages:iam.oauthClients.duration.hour', { count: s / 3600 });
    if (s % 60 === 0) return t('pages:iam.oauthClients.duration.minute', { count: s / 60 });
    return t('pages:iam.oauthClients.duration.second', { count: s });
  };
}

function CopyButton({ value, ariaLabel }: { value: string; ariaLabel: string }) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const onClick = useCallback(async () => {
    await navigator.clipboard.writeText(value);
    addToast(t('common:copied'), 'success');
  }, [value, addToast, t]);
  return (
    <button
      type="button"
      onClick={onClick}
      className={styles.copyButton}
      aria-label={ariaLabel}
      data-design-system-escape="primitive-internal"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10.5 5.5V3.5C10.5 2.67 9.83 2 9 2H3.5C2.67 2 2 2.67 2 3.5V9C2 9.83 2.67 10.5 3.5 10.5H5.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </button>
  );
}

export function OAuthClientDetailPage() {
  const { t } = useTranslation();
  const formatSeconds = useFormatSeconds();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const canEdit = usePermission('oauth-client:update');
  const canRotate = usePermission('oauth-client:rotate');
  const canDelete = usePermission('oauth-client:delete');

  const { data, loading, error, refetch } = useApi<{ data: OAuthClient }>(
    () => oauthClientApi.getOne(id!),
    ['admin', 'oauth-clients', 'detail', id ?? ''],
    { skip: !id },
  );

  const [showRotateConfirm, setShowRotateConfirm] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);

  const { mutate: rotateSecret, loading: rotating } = useMutation(
    (cid: string) => oauthClientApi.rotateSecret(cid),
    {
      invalidateQueries: [['admin', 'oauth-clients']],
      onSuccess: (result) => {
        const secret = (result as { data?: OAuthClientRotateResponse }).data?.clientSecret;
        if (secret) setRevealedSecret(secret);
        setShowRotateConfirm(false);
      },
      successMessage: t('pages:iam.oauthClients.toastRotated'),
    },
  );

  const { mutate: deleteClient, loading: deleting } = useMutation(
    (cid: string) => oauthClientApi.remove(cid),
    {
      invalidateQueries: [['admin', 'oauth-clients']],
      onSuccess: () => {
        setShowDelete(false);
        navigate('/iam/oauth-clients');
      },
      successMessage: t('pages:iam.oauthClients.toastDeleted'),
    },
  );

  if (!id) return <Navigate to="/iam/oauth-clients" replace />;
  if (loading) return <Skeleton.DetailPageSkeleton />;
  if (error) return <ErrorBanner message={error.message} onRetry={refetch} />;

  const client = data?.data;
  if (!client) return <ErrorBanner message={t('pages:iam.oauthClients.notFound')} />;

  const isPublic = client.type === 'public';
  const activeRefreshTokenCount = client.activeRefreshTokenCount ?? 0;

  return (
    <Stack gap="lg">
      <Breadcrumb items={[
        { label: t('pages:iam.oauthClients.pageTitle'), to: '/iam/oauth-clients' },
        { label: client.name },
      ]} />

      <PageHeader
        title={client.name}
        action={
          <Stack direction="horizontal" gap="sm">
            {canEdit && (
              <Button variant="secondary" onClick={() => navigate(`/iam/oauth-clients/${client.id}/edit`)}>
                {t('common:edit')}
              </Button>
            )}
            {canRotate && !isPublic && (
              <Button variant="secondary" onClick={() => setShowRotateConfirm(true)}>
                {t('pages:iam.oauthClients.rotateSecretButton')}
              </Button>
            )}
            {canDelete && (
              <Button variant="danger" onClick={() => setShowDelete(true)}>
                {t('common:delete')}
              </Button>
            )}
          </Stack>
        }
      />

      <div className={styles.subtitle}>
        <span className={styles.idMono}>{client.id}</span>
        <CopyButton value={client.id} ariaLabel={t('common:copy')} />
        <span className={isPublic ? styles.typeBadgePublic : styles.typeBadgeConfidential}>
          {isPublic
            ? t('pages:iam.oauthClients.typePublic')
            : t('pages:iam.oauthClients.typeConfidential')}
        </span>
        <span className={styles.createdAt}>
          {new Date(client.createdAt).toLocaleDateString()}
        </span>
      </div>

      {/* Card 1 — Authentication */}
      <Card>
        <Stack gap="md">
          <h2 className={styles.cardTitle}>{t('pages:iam.oauthClients.cardAuthentication')}</h2>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>{t('pages:iam.oauthClients.clientIdLabel')}</span>
            <span className={styles.fieldValueMono}>{client.id}</span>
            <CopyButton value={client.id} ariaLabel={t('common:copy')} />
          </div>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>{t('pages:iam.oauthClients.clientSecretLabel')}</span>
            {isPublic ? (
              <Tooltip content={t('pages:iam.oauthClients.publicClientNoSecretTooltip')}>
                <span className={styles.publicNoSecret}>
                  {t('pages:iam.oauthClients.publicClientNoSecret')}
                </span>
              </Tooltip>
            ) : (
              <Stack direction="horizontal" gap="sm">
                <span className={styles.secretMask} aria-label="masked secret">
                  {t('pages:iam.oauthClients.secretMasked')}
                </span>
                <span className={styles.lastRotated}>
                  {client.lastSecretRotatedAt
                    ? t('pages:iam.oauthClients.lastRotated', { relative: formatRelativeTime(client.lastSecretRotatedAt) })
                    : t('pages:iam.oauthClients.neverRotated')}
                </span>
              </Stack>
            )}
          </div>
        </Stack>
      </Card>

      {/* Card 2 — Redirect URIs */}
      <Card>
        <Stack gap="md">
          <h2 className={styles.cardTitle}>{t('pages:iam.oauthClients.cardRedirectUris')}</h2>
          <ul className={styles.uriList}>
            {client.redirectUris.map((uri) => (
              <li key={uri} className={styles.uriRow}>
                <code className={styles.uriValue}>{uri}</code>
                <CopyButton value={uri} ariaLabel={t('common:copy')} />
              </li>
            ))}
          </ul>
        </Stack>
      </Card>

      {/* Card 3 — Allowed scopes */}
      <Card>
        <Stack gap="md">
          <h2 className={styles.cardTitle}>{t('pages:iam.oauthClients.cardAllowedScopes')}</h2>
          <div className={styles.scopeGrid}>
            {client.allowedScopes.map((scope) => (
              <ScopeChip key={scope} scope={scope} />
            ))}
          </div>
        </Stack>
      </Card>

      {/* Card 4 — Security */}
      <Card>
        <Stack gap="md">
          <h2 className={styles.cardTitle}>{t('pages:iam.oauthClients.cardSecurity')}</h2>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>{t('pages:iam.oauthClients.requirePkceLabel')}</span>
            <span className={styles.fieldValue}>
              {client.requirePkce ? t('common:yes') : t('common:no')}
              {isPublic && (
                <span className={styles.fieldHint}>
                  {' '}{t('pages:iam.oauthClients.requirePkceForcedByType')}
                </span>
              )}
            </span>
          </div>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>{t('pages:iam.oauthClients.accessTtlLabel')}</span>
            <span className={styles.fieldValue}>
              {formatSeconds(client.accessTtlSeconds)}
              <span className={styles.fieldHint}>{' '}({client.accessTtlSeconds}s)</span>
            </span>
          </div>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>{t('pages:iam.oauthClients.refreshTtlLabel')}</span>
            <span className={styles.fieldValue}>
              {formatSeconds(client.refreshTtlSeconds)}
              <span className={styles.fieldHint}>{' '}({client.refreshTtlSeconds}s)</span>
            </span>
          </div>
        </Stack>
      </Card>

      {/* Card 5 — Activity */}
      <Card>
        <Stack gap="md">
          <h2 className={styles.cardTitle}>{t('pages:iam.oauthClients.cardActivity')}</h2>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>{t('pages:iam.oauthClients.activeRefreshTokensLabel')}</span>
            <Tooltip content={t('pages:iam.oauthClients.activeRefreshTokensTooltip')}>
              <span className={styles.fieldValue}>{activeRefreshTokenCount}</span>
            </Tooltip>
          </div>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>{t('pages:iam.oauthClients.lastUpdatedLabel')}</span>
            <span className={styles.fieldValue}>{formatRelativeTime(client.updatedAt)}</span>
          </div>
        </Stack>
      </Card>

      {/* Rotate confirm — plain AlertDialog (interpolated body, no custom input). */}
      <AlertDialog
        open={showRotateConfirm}
        onOpenChange={(o) => { if (!o) setShowRotateConfirm(false); }}
        title={t('pages:iam.oauthClients.rotateConfirmTitle')}
        description={t('pages:iam.oauthClients.rotateConfirmBody', { count: activeRefreshTokenCount })}
        confirmLabel={t('pages:iam.oauthClients.rotateConfirmConfirm')}
        cancelLabel={t('pages:iam.oauthClients.rotateConfirmCancel')}
        variant="danger"
        loading={rotating}
        onConfirm={() => rotateSecret(client.id)}
      />

      {/* Secret reveal — hard-gated by the ack checkbox. */}
      <SecretDialog
        open={revealedSecret !== null}
        secret={revealedSecret}
        title={t('pages:iam.oauthClients.secretRevealTitle')}
        warning={t('pages:iam.oauthClients.secretRevealWarning')}
        requireAcknowledgement
        acknowledgementLabel={t('pages:iam.oauthClients.secretRevealAckCheckbox')}
        onClose={() => setRevealedSecret(null)}
      />

      {/* Delete — type-to-confirm. */}
      <DeleteClientConfirmDialog
        open={showDelete}
        clientId={client.id}
        activeRefreshTokenCount={activeRefreshTokenCount}
        loading={deleting}
        onCancel={() => setShowDelete(false)}
        onConfirm={() => deleteClient(client.id)}
      />
    </Stack>
  );
}
