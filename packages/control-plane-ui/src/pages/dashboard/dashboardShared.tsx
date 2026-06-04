import { Tooltip } from '@/components/ui';
import styles from './DashboardPage.module.css';

/* ── Time window ────────────────────────────────────────────────────────── */

export type TimeWindow = '1h' | '1d' | '7d' | '30d';

export const WINDOW_MS: Record<TimeWindow, number> = {
  '1h':  60 * 60_000,
  '1d':  24 * 60 * 60_000,
  '7d':  7  * 24 * 60 * 60_000,
  '30d': 30 * 24 * 60 * 60_000,
};

export const WINDOW_OPTIONS: TimeWindow[] = ['1h', '1d', '7d', '30d'];

/* ── Info icon ──────────────────────────────────────────────────────────── */

export function InfoIcon({ description }: { description: string }) {
  return (
    <Tooltip content={description} side="bottom">
      <span className={styles.infoIcon}>i</span>
    </Tooltip>
  );
}
