import { useTranslation } from 'react-i18next';
import type { AgentDevice } from '@/api/types';
import { Card } from '@/components/ui';
import { DeviceTagEditor } from '../DeviceTagEditor';
import styles from '../FleetDeviceDetailPage.module.css';

interface IdentityCardProps {
  device: AgentDevice;
  copyToClipboard: (text: string) => void;
  onTagsSaved: () => void;
}

export function IdentityCard({ device, copyToClipboard, onTagsSaved }: IdentityCardProps) {
  const { t } = useTranslation();
  return (
    /* Identity card — first-class natural-key identifiers + currently
        bound user. Replaces the old simple kvGrid. */
    <Card>
      <div className={styles.kvGrid}>
        <span className={styles.kvLabel}>{t('pages:devices.identity.hostname')}</span>
        <span className={styles.kvValue}>{device.hostname}</span>
        {device.boundUserDisplayName && (
          <>
            <span className={styles.kvLabel}>{t('pages:devices.identity.boundUser')}</span>
            <span className={styles.kvValue}>
              {device.boundUserDisplayName}
              {device.boundUserEmail && <span style={{ color: 'var(--color-text-muted)' }}>{' · '}{device.boundUserEmail}</span>}
            </span>
          </>
        )}
        {device.physicalId && (
          <>
            <span className={styles.kvLabel}>{t('pages:devices.identity.physicalId')}</span>
            <span className={styles.kvValue}>
              <code>{device.physicalId}</code>
              <button
                type="button"
                onClick={() => copyToClipboard(device.physicalId!)}
                title={t('common:copy')}
                style={{ marginLeft: 'var(--g-space-2)', padding: 'var(--g-space-0-5) var(--g-space-1-5)', border: '1px solid var(--color-border)', borderRadius: 'var(--g-radius-sm)', background: 'none', cursor: 'pointer' }}
              >⧉</button>
            </span>
          </>
        )}
        <span className={styles.kvLabel}>{t('pages:devices.identity.thingId')}</span>
        <span className={styles.kvValue}>
          <code>{device.id}</code>
          <button
            type="button"
            onClick={() => copyToClipboard(device.id)}
            title={t('common:copy')}
            style={{ marginLeft: 'var(--g-space-2)', padding: 'var(--g-space-0-5) var(--g-space-1-5)', border: '1px solid var(--color-border)', borderRadius: 'var(--g-radius-sm)', background: 'none', cursor: 'pointer' }}
          >⧉</button>
        </span>
        {device.primaryIp && (
          <>
            <span className={styles.kvLabel}>{t('pages:devices.identity.ip')}</span>
            <span className={styles.kvValue}><code>{device.primaryIp}</code></span>
          </>
        )}
        <span className={styles.kvLabel}>{t('pages:fleet.os')}</span>
        <span className={styles.kvValue}>{device.os === 'darwin' ? 'macOS' : device.os} {device.osVersion}</span>
        <span className={styles.kvLabel}>{t('pages:fleet.agentVersion')}</span>
        <span className={styles.kvValue}>{device.agentVersion}</span>
        <span className={styles.kvLabel}>{t('pages:fleet.lastHeartbeat')}</span>
        <span className={styles.kvValue}>{device.lastHeartbeat ? new Date(device.lastHeartbeat).toLocaleString() : '—'}</span>
        <span className={styles.kvLabel}>{t('pages:devices.enrolledAt')}</span>
        <span className={styles.kvValue}>{new Date(device.enrolledAt).toLocaleString()} {device.enrolledBy ? `· ${device.enrolledBy}` : ''}</span>
      </div>
      {/* Tag editor — below the kvGrid so it stays inside the Identity card */}
      <div style={{ marginTop: 'var(--g-space-4)', paddingTop: 'var(--g-space-3)', borderTop: '1px solid var(--color-border)' }}>
        <div style={{ fontSize: 'var(--g-font-size-sm)', fontWeight: 'var(--g-font-weight-semibold)', marginBottom: 'var(--g-space-2)' }}>
          {t('pages:devices.tagsLabel', 'Tags')}
        </div>
        <DeviceTagEditor
          deviceId={device.id}
          initialTags={device.tags ?? []}
          onSaved={onTagsSaved}
        />
      </div>
    </Card>
  );
}
