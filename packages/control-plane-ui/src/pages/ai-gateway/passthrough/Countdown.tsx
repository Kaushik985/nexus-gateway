import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './PassthroughPage.module.css';

export function Countdown({ expiresAt }: { expiresAt?: string | null }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!expiresAt) return <span>{t('pages:passthrough.countdown.noExpiry')}</span>;
  const remainingMs = new Date(expiresAt).getTime() - now;
  if (remainingMs <= 0) return <span className={styles.countdownExpired}>{t('pages:passthrough.countdown.expired')}</span>;
  const totalSec = Math.floor(remainingMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return <span className={styles.countdownActive}>{h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`}</span>;
}
