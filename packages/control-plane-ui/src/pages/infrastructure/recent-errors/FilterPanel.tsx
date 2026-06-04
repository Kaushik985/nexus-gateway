import { useTranslation } from 'react-i18next';
import { Card, Button, Select, Stack } from '@/components/ui';
import { ALL, NODE_TYPE_OPTIONS } from './recentErrorsHelpers';
import styles from './InfraRecentErrorsPage.module.css';

interface FilterPanelProps {
  filterOpen: boolean;
  setFilterOpen: React.Dispatch<React.SetStateAction<boolean>>;
  timeRange: string;
  setTimeRange: (v: string) => void;
  nodeType: string;
  setNodeType: (v: string) => void;
  eventType: string;
  setEventType: (v: string) => void;
  hideSilenced: boolean;
  setHideSilenced: React.Dispatch<React.SetStateAction<boolean>>;
  onRefresh: () => void;
}

export function FilterPanel({
  filterOpen,
  setFilterOpen,
  timeRange,
  setTimeRange,
  nodeType,
  setNodeType,
  eventType,
  setEventType,
  hideSilenced,
  setHideSilenced,
  onRefresh,
}: FilterPanelProps) {
  const { t } = useTranslation('pages');

  return (
    /* ── Filter panel (collapsed by default; sits above Issues so the
         bar between hero and list stays the focal point for triage) ── */
    <Card>
      <Stack gap="sm">
        <button
          type="button"
          className={styles.filterToggle}
          onClick={() => setFilterOpen((v) => !v)}
          aria-expanded={filterOpen}
        >
          {filterOpen ? '▼' : '▶'} {t('infrastructure.recentErrors.filtersHeading')}
        </button>
        {filterOpen && (
          <div className={styles.filterBar}>
            <div className={styles.filterField}>
              <span className={styles.filterLabel}>{t('infrastructure.recentErrors.filterTimeRange')}</span>
              <Select
                value={timeRange}
                onValueChange={setTimeRange}
                options={[
                  { value: '1h', label: t('infrastructure.recentErrors.range1h') },
                  { value: '24h', label: t('infrastructure.recentErrors.range24h') },
                  { value: '7d', label: t('infrastructure.recentErrors.range7d') },
                  { value: '30d', label: t('infrastructure.recentErrors.range30d') },
                ]}
              />
            </div>
            <div className={styles.filterField}>
              <span className={styles.filterLabel}>{t('infrastructure.recentErrors.filterThingType')}</span>
              <Select
                value={nodeType || ALL}
                onValueChange={(v) => setNodeType(v === ALL ? '' : v)}
                options={[
                  { value: ALL, label: t('infrastructure.filterAll') },
                  ...NODE_TYPE_OPTIONS.map((s) => ({ value: s, label: s })),
                ]}
              />
            </div>
            <div className={styles.filterField}>
              <span className={styles.filterLabel}>{t('infrastructure.recentErrors.filterEventType')}</span>
              <Select
                value={eventType || ALL}
                onValueChange={(v) => setEventType(v === ALL ? '' : v)}
                options={[
                  { value: ALL, label: t('infrastructure.filterAll') },
                  { value: 'error', label: t('infrastructure.recentErrors.eventTypeError') },
                  { value: 'crash', label: t('infrastructure.recentErrors.eventTypeCrash') },
                  { value: 'lifecycle', label: t('infrastructure.recentErrors.eventTypeLifecycle') },
                  { value: 'watchdog', label: t('infrastructure.recentErrors.eventTypeWatchdog') },
                ]}
              />
            </div>
            <div className={styles.filterField}>
              <span className={styles.filterLabel}>{t('infrastructure.recentErrors.filterShowSilenced')}</span>
              <Button
                type="button"
                variant={hideSilenced ? 'secondary' : 'primary'}
                size="sm"
                onClick={() => setHideSilenced((v) => !v)}
              >
                {hideSilenced
                  ? t('infrastructure.recentErrors.filterShowSilencedOff')
                  : t('infrastructure.recentErrors.filterShowSilencedOn')}
              </Button>
            </div>
            <div className={styles.filterField}>
              <span className={styles.filterLabel}>&nbsp;</span>
              <Button type="button" variant="secondary" size="sm" onClick={onRefresh}>
                {t('infrastructure.recentErrors.refresh')}
              </Button>
            </div>
          </div>
        )}
      </Stack>
    </Card>
  );
}
