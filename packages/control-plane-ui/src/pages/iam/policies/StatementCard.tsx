import { useTranslation } from 'react-i18next';
import { FormField, Input, Select, Button, Stack } from '@/components/ui';
import type { ActionCatalogResponse } from '@/api/services';
import type { StatementEntry } from '../_shared/iam-policy-document';
import styles from '../_shared/Iam.module.css';
import editorStyles from './IamPolicyEditorPage.module.css';
import { ChipInput } from '../_shared/ChipInput';
import { CatalogPicker } from '../_shared/CatalogPicker';
import { ScopedActionsPicker } from '../_shared/ScopedActionsPicker';
import {
  CANONICAL_ACTION_RE,
  CANONICAL_NRN_RE,
  SCOPE_MIXED,
  SCOPE_WILDCARD,
  SCOPE_PICK,
  RESOURCE_ALL,
  SERVICE_ORDER,
  computeSelectedScope,
  actionsAsArray,
  actionsAsString,
  summarizeStatement,
} from './iamPolicyScope';

interface StatementCardProps {
  stmt: StatementEntry;
  idx: number;
  statementsCount: number;
  isExpanded: boolean;
  intendedScope: string | undefined;
  pickerOpen: boolean;
  catalogResp: ActionCatalogResponse | null | undefined;
  actionSuggestions: string[];
  nrnSuggestions: string[];
  onToggleExpand: () => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onUpdate: (field: keyof StatementEntry, value: string) => void;
  onServiceScope: (value: string) => void;
  onResourceScope: (value: string) => void;
  onTogglePicker: () => void;
  onClosePicker: () => void;
}

export function StatementCard({
  stmt,
  idx,
  statementsCount,
  isExpanded,
  intendedScope,
  pickerOpen,
  catalogResp,
  actionSuggestions,
  nrnSuggestions,
  onToggleExpand,
  onMove,
  onDuplicate,
  onRemove,
  onUpdate,
  onServiceScope,
  onResourceScope,
  onTogglePicker,
  onClosePicker,
}: StatementCardProps) {
  const { t } = useTranslation();
  const summary = summarizeStatement(stmt);
  return (
    <div className={styles.editorCard}>
      {/* Collapsible header — click to expand/collapse; reorder +
          duplicate + remove buttons stop propagation. */}
      <div
        className={styles.statementHeaderRow}
        onClick={onToggleExpand}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleExpand();
          }
        }}
      >
        <span className={isExpanded ? styles.statementChevronOpen : styles.statementChevron}>▶</span>
        <span className={stmt.effect === 'Allow' ? styles.effectBadgeAllow : styles.effectBadgeDeny}>
          {stmt.effect === 'Allow' ? t('pages:iam.allow') : t('pages:iam.deny')}
        </span>
        <span className={styles.statementSummary}>
          {summary.actions ? (
            <>
              <span>{summary.actions.head}</span>
              {summary.actions.extra > 0 && (
                <span className={styles.statementSummaryDim}>+{summary.actions.extra}</span>
              )}
            </>
          ) : (
            <span className={styles.statementSummaryPlaceholder}>{t('pages:iam.summaryNoActions')}</span>
          )}
          <span className={styles.statementSummaryDim}>{t('pages:iam.summaryOn')}</span>
          {summary.resources ? (
            <>
              <span>{summary.resources.head}</span>
              {summary.resources.extra > 0 && (
                <span className={styles.statementSummaryDim}>+{summary.resources.extra}</span>
              )}
            </>
          ) : (
            <span className={styles.statementSummaryPlaceholder}>{t('pages:iam.summaryNoResources')}</span>
          )}
        </span>
        <div className={styles.statementHeaderActions} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={styles.statementIconBtn}
            onClick={() => onMove(-1)}
            disabled={idx === 0}
            title={t('pages:iam.moveUp')}
            aria-label={t('pages:iam.moveUp')}
          >
            ↑
          </button>
          <button
            type="button"
            className={styles.statementIconBtn}
            onClick={() => onMove(1)}
            disabled={idx === statementsCount - 1}
            title={t('pages:iam.moveDown')}
            aria-label={t('pages:iam.moveDown')}
          >
            ↓
          </button>
          <button
            type="button"
            className={styles.statementIconBtn}
            onClick={onDuplicate}
            title={t('pages:iam.duplicate')}
            aria-label={t('pages:iam.duplicate')}
          >
            ⧉
          </button>
          <button
            type="button"
            className={styles.statementIconBtnDanger}
            onClick={onRemove}
            disabled={statementsCount <= 1}
            title={t('pages:iam.remove')}
            aria-label={t('pages:iam.remove')}
          >
            ×
          </button>
        </div>
      </div>

      {isExpanded && (
      <div className={styles.statementBody}>
      <Stack direction="horizontal" gap="md" className={editorStyles.fieldsRow}>
        <div className={editorStyles.sidField}>
          <FormField label={t('pages:iam.sidLabel')}>
            <Input
              value={stmt.sid}
              onChange={(e) => onUpdate('sid', e.target.value)}
              placeholder={t('pages:iam.placeholderSid')}
            />
          </FormField>
        </div>
        <div className={editorStyles.effectField}>
          <FormField label={t('pages:iam.effect')} required>
            <Select
              value={stmt.effect}
              onValueChange={(v) => onUpdate('effect', v)}
              options={[
                { value: 'Allow', label: t('pages:iam.allow') },
                { value: 'Deny', label: t('pages:iam.deny') },
              ]}
            />
          </FormField>
        </div>
      </Stack>

      {(() => {
        // Three-level scope: Service → Resource → Action.
        //   Service select decides the top bucket (gateway / compliance /
        //   agent / platform / iam) plus the cross-service sentinels
        //   (wildcard, mixed).
        //   Resource select is visible only when a real service is
        //   picked, and offers a "* (all resources)" option plus the
        //   catalog resources owned by that service.
        //   Actions picker dispatches on the resulting scope: scoped
        //   resource → ScopedActionsPicker, service-wildcard → admin:*
        //   banner with service context, cross-service wildcard →
        //   plain admin:* banner, mixed → ChipInput + CatalogPicker.
        const scope = computeSelectedScope(stmt, intendedScope, catalogResp);
        const serviceValue =
          scope.kind === 'pick' ? SCOPE_PICK
          : scope.kind === 'wildcard' ? SCOPE_WILDCARD
          : scope.kind === 'mixed' ? SCOPE_MIXED
          : scope.service;
        const resourceValue =
          scope.kind === 'service' ? SCOPE_PICK
          : scope.kind === 'service-wildcard' ? RESOURCE_ALL
          : scope.kind === 'resource' ? scope.resource
          : SCOPE_PICK;
        const showResourceSelect =
          scope.kind === 'service' || scope.kind === 'service-wildcard' || scope.kind === 'resource';
        const scopedResource =
          scope.kind === 'resource'
            ? catalogResp?.resources.find((r) => r.type === scope.resource)
            : undefined;
        const resourcesForService =
          showResourceSelect
            ? (catalogResp?.resources ?? [])
                .filter((r) => r.service === scope.service)
                .sort((a, b) => a.type.localeCompare(b.type))
            : [];

        return (
          <>
            <FormField label={t('pages:iam.serviceScopeLabel')}>
              <Select
                value={serviceValue}
                onValueChange={(v) => onServiceScope(v)}
                options={[
                  { value: SCOPE_PICK, label: t('pages:iam.scopePickServicePlaceholder') },
                  ...SERVICE_ORDER.map((s) => ({
                    value: s,
                    label: t(`pages:iam.services.${s}`, { defaultValue: s }),
                  })),
                  { value: SCOPE_WILDCARD, label: t('pages:iam.scopeWildcardLabel') },
                  { value: SCOPE_MIXED, label: t('pages:iam.scopeMixedLabel') },
                ]}
              />
            </FormField>

            {showResourceSelect && (
              <FormField label={t('pages:iam.resourceScopeLabel')}>
                <Select
                  value={resourceValue}
                  onValueChange={(v) => onResourceScope(v)}
                  options={[
                    { value: SCOPE_PICK, label: t('pages:iam.scopePickResourcePlaceholder') },
                    { value: RESOURCE_ALL, label: t('pages:iam.scopeResourceAllLabel') },
                    ...resourcesForService.map((r) => ({
                      value: r.type,
                      label: t('pages:iam.scopeResourceLabel', { resource: r.type }),
                    })),
                  ]}
                />
              </FormField>
            )}

            <FormField label={t('pages:iam.actionsLabel')}>
              {scopedResource ? (
                <ScopedActionsPicker
                  resource={scopedResource}
                  currentActions={actionsAsArray(stmt.actions)}
                  onChange={(next) =>
                    onUpdate('actions', actionsAsString(next))
                  }
                />
              ) : scope.kind === 'service-wildcard' ? (
                <div className={styles.wildcardBanner}>
                  <code>admin:*</code>
                  <span>
                    {t('pages:iam.serviceWildcardDescription', {
                      service: t(`pages:iam.services.${scope.service}`, { defaultValue: scope.service }),
                    })}
                  </span>
                </div>
              ) : scope.kind === 'wildcard' ? (
                <div className={styles.wildcardBanner}>
                  <code>admin:*</code>
                  <span>{t('pages:iam.wildcardDescription')}</span>
                </div>
              ) : scope.kind === 'service' ? (
                <div className={styles.wildcardBanner}>
                  <span>{t('pages:iam.scopePickResourceHint')}</span>
                </div>
              ) : (
                // Mixed (multi-resource or vendor-pasted) or empty
                // without intended scope → fall through to chip
                // input + catalog browser.
                <Stack gap="xs">
                  <ChipInput
                    value={stmt.actions}
                    onChange={(next) => onUpdate('actions', next)}
                    suggestions={actionSuggestions}
                    validate={(c) => CANONICAL_ACTION_RE.test(c)}
                    invalidHint={t('pages:iam.actionInvalidHint')}
                    placeholder={t('pages:iam.actionsChipPlaceholder')}
                    ariaLabel={t('pages:iam.actionsLabel')}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onTogglePicker}
                    aria-expanded={pickerOpen}
                  >
                    {pickerOpen
                      ? t('pages:iam.hideCatalogBrowser')
                      : t('pages:iam.browseCatalog')}
                  </Button>
                  {pickerOpen && (
                    <CatalogPicker
                      catalog={catalogResp ?? null}
                      currentActions={actionsAsArray(stmt.actions)}
                      onChange={(next) =>
                        onUpdate('actions', actionsAsString(next))
                      }
                      onClose={onClosePicker}
                    />
                  )}
                </Stack>
              )}
            </FormField>
          </>
        );
      })()}

      <FormField label={t('pages:iam.resourcesLabel')}>
        <ChipInput
          value={stmt.resources}
          onChange={(next) => onUpdate('resources', next)}
          suggestions={nrnSuggestions}
          validate={(c) => CANONICAL_NRN_RE.test(c)}
          invalidHint={t('pages:iam.nrnInvalidHint')}
          placeholder={t('pages:iam.resourcesChipPlaceholder')}
          ariaLabel={t('pages:iam.resourcesLabel')}
        />
      </FormField>

      {/* Conditions: dropped from form view — no managed
          policy uses them, the textarea was a raw-JSON power-user
          feature with no visual builder, and exposing it in the
          form crowded the rest of the editor. The engine still
          supports Condition operators (packages/control-plane/
          internal/iam/conditions.go); JSON view (above) remains
          editable for round-trip preservation of vendor-pasted
          policies that ship conditions. */}
      </div>
      )}
    </div>
  );
}
