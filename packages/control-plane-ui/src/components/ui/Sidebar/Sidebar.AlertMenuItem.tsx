import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { alertsApi } from '@/api/services/alerts/alerts';
import { DropdownMenuItem } from '../DropdownMenu';
import { MenuIcon } from './Sidebar.icons';
import styles from './Sidebar.module.css';

const ALERT_POLL_INTERVAL_MS = 60_000;

export function SidebarAlertMenuItem() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    try {
      const res = await alertsApi.list({ state: ['firing'], limit: 1 });
      setCount(res.total ?? 0);
    } catch {
      setCount(0);
    }
  }, []);

  useEffect(() => {
    void fetchCount();
    const timer = setInterval(() => void fetchCount(), ALERT_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchCount]);

  return (
    <DropdownMenuItem className={styles.userMenuItem} onSelect={() => navigate('/alerts')}>
      <MenuIcon name="bell" />
      <span className={styles.menuItemLabel}>{t('common:notifications')}</span>
      {count > 0 && (
        <span className={styles.menuBadge}>{count > 99 ? '99+' : count}</span>
      )}
    </DropdownMenuItem>
  );
}
