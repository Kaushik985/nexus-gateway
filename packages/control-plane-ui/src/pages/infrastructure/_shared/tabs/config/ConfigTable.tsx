import { useTranslation } from 'react-i18next';
import type {
  AppliedConfigResponse,
  NodeAppliedOutcome,
} from '@/api/services/infrastructure/nodes/hub';
import { Button, Tooltip } from '@/components/ui';
import { NON_OVERRIDABLE, renderJson, deepEqualJson } from './configHelpers';
import styles from './ConfigurationTab.module.css';

export interface ConfigTableProps {
  data: AppliedConfigResponse;
  sortedKeys: string[];
  appliedOutcomes?: Record<string, NodeAppliedOutcome> | null;
  resyncingKey: string | null;
  resyncingAll: boolean;
  clearingKey: string | null;
  openEditor: (mode: 'add' | 'edit', configKey: string) => void;
  handleClearOverride: (configKey: string) => void;
  handleResyncKey: (configKey: string) => void;
}

export function ConfigTable({
  data,
  sortedKeys,
  appliedOutcomes,
  resyncingKey,
  resyncingAll,
  clearingKey,
  openEditor,
  handleClearOverride,
  handleResyncKey,
}: ConfigTableProps) {
  const { t, i18n } = useTranslation();

  return (
    <div className={styles.tableWrap}>
      <div className={styles.table} role="table">
        <div className={styles.headerRow} role="row">
          <div className={styles.headerCell} role="columnheader">
            {t('pages:infrastructure.configuration.colKey')}
          </div>
          <div className={styles.headerCell} role="columnheader">
            {t('pages:infrastructure.configuration.colTemplate')}
          </div>
          <div className={styles.headerCell} role="columnheader">
            {t('pages:infrastructure.configuration.colOverride')}
          </div>
          <div className={styles.headerCell} role="columnheader">
            {t('pages:infrastructure.configuration.colApplied')}
          </div>
          <div className={styles.headerCell} role="columnheader">
            {t('pages:infrastructure.configuration.actions')}
          </div>
        </div>

        {sortedKeys.map((configKey) => {
          const entry = data.configs[configKey];
          const isBlacklisted = NON_OVERRIDABLE.has(configKey);
          const hasOverride = !!entry.override;
          const stale = !!entry.override?.stale;
          const outcome = appliedOutcomes?.[configKey] ?? null;
          const applyError = outcome?.applyError ?? null;

          const appliedEqualsTemplate =
            entry.templateState !== undefined &&
            deepEqualJson(entry.appliedConfig, entry.templateState);
          const appliedEqualsOverride =
            entry.override !== undefined &&
            deepEqualJson(entry.appliedConfig, entry.override.state);

          const rowClass = [
            styles.row,
            hasOverride ? styles.overrideRow : '',
            isBlacklisted ? styles.blacklistRow : '',
            applyError ? styles.applyErrorRow : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <div key={configKey} className={rowClass} role="row">
              <div className={styles.cell} role="cell">
                <div className={styles.keyCell}>
                  <div className={styles.keyHeading}>
                    <code className={styles.keyCode}>{configKey}</code>
                    {hasOverride && (
                      <span className={styles.overrideBadge}>
                        {t('pages:infrastructure.configuration.overrideBadge')}
                      </span>
                    )}
                    {stale && (
                      <span className={styles.staleBadge}>
                        {t('pages:infrastructure.configuration.staleBadge')}
                      </span>
                    )}
                    {isBlacklisted && (
                      <span className={styles.globalOnlyBadge}>
                        {t('pages:infrastructure.configuration.globalOnlyBadge')}
                      </span>
                    )}
                  </div>
                  <span className={styles.keyMeta}>
                    {t('pages:infrastructure.configuration.templateNoteAtVer', {
                      n: entry.templateVer ?? 0,
                    })}
                  </span>
                  {outcome?.appliedAt && (
                    <span className={styles.keyMeta}>
                      {t('pages:infrastructure.configuration.lastAppliedAt', {
                        when: new Date(outcome.appliedAt).toLocaleString(i18n.language),
                        version: outcome.appliedVersion ?? 0,
                      })}
                    </span>
                  )}
                  {applyError && (
                    <span
                      className={styles.applyErrorPill}
                      title={`${applyError.message}\n@ ${new Date(applyError.at).toLocaleString(i18n.language)}`}
                    >
                      <span className={styles.applyErrorIcon} aria-hidden="true">{'⚠'}</span>
                      {t('pages:infrastructure.configuration.applyErrorBadge')}
                    </span>
                  )}
                </div>
              </div>

              <div className={styles.cell} role="cell">
                <pre
                  className={styles.jsonCell}
                  data-testid={`config-template-${configKey}`}
                >
                  {renderJson(entry.templateState)}
                </pre>
              </div>

              <div className={styles.cell} role="cell">
                {hasOverride ? (
                  <pre
                    className={styles.jsonCell}
                    data-testid={`config-override-${configKey}`}
                  >
                    {renderJson(entry.override?.state)}
                  </pre>
                ) : (
                  <span className={styles.dash}>{'—'}</span>
                )}
              </div>

              <div className={styles.cell} role="cell">
                {appliedEqualsOverride && hasOverride ? (
                  <span className={styles.equalsHint}>
                    {t('pages:infrastructure.configuration.equalsOverride')}
                  </span>
                ) : appliedEqualsTemplate && !hasOverride ? (
                  <span className={styles.equalsHint}>
                    {t('pages:infrastructure.configuration.equalsTemplate')}
                  </span>
                ) : (
                  <pre
                    className={styles.jsonCell}
                    data-testid={`config-applied-${configKey}`}
                  >
                    {renderJson(entry.appliedConfig)}
                  </pre>
                )}
              </div>

              <div className={styles.cell} role="cell">
                <div className={styles.actions}>
                  {hasOverride ? (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={isBlacklisted}
                        onClick={() => openEditor('edit', configKey)}
                      >
                        {t('pages:infrastructure.configuration.editOverride')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={clearingKey === configKey}
                        disabled={isBlacklisted}
                        onClick={() => handleClearOverride(configKey)}
                      >
                        {t('pages:infrastructure.configuration.clearOverride')}
                      </Button>
                    </>
                  ) : isBlacklisted ? (
                    <Tooltip content={t('pages:infrastructure.configuration.globalOnlyTooltip')}>
                      <span>
                        <Button variant="secondary" size="sm" disabled>
                          {t('pages:infrastructure.configuration.addOverride')}
                        </Button>
                      </span>
                    </Tooltip>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openEditor('add', configKey)}
                    >
                      {t('pages:infrastructure.configuration.addOverride')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={resyncingKey === configKey}
                    disabled={resyncingAll}
                    onClick={() => handleResyncKey(configKey)}
                  >
                    {entry.inSync
                      ? t('pages:infrastructure.configuration.forceResync')
                      : t('pages:infrastructure.configuration.syncNow')}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
