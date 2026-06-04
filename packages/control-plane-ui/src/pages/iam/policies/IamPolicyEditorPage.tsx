import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  PageHeader, FormField, Switch, Tooltip,
  LoadingSpinner, ErrorBanner, Breadcrumb, Button, Stack, Card,
} from '@/components/ui';
import { useZodForm, FormInput } from '@/lib/forms';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import { z } from 'zod';
import { useMutation } from '../../../hooks/useMutation';
import { useApi } from '../../../hooks/useApi';
import { iamApi } from '@/api/services';
import type { ActionCatalogResponse, CreateIamPolicyInput, UpdateIamPolicyInput } from '@/api/services';
import type { IamPolicy, IamPolicyDocument } from '../../../api/types';
import {
  DEFAULT_IAM_POLICY_VERSION,
  documentToStatements,
  statementsToDocument,
  parsePolicyDocumentJson,
  validateIamPolicyDocument,
  type StatementEntry,
} from '../_shared/iam-policy-document';
import styles from '../_shared/Iam.module.css';
import editorStyles from './IamPolicyEditorPage.module.css';
import {
  computeSelectedScope,
  isService,
  SCOPE_MIXED,
  SCOPE_WILDCARD,
  SCOPE_PICK,
  SCOPE_SVC_PREFIX,
  SCOPE_SVC_ALL_PREFIX,
  RESOURCE_ALL,
  type ServiceName,
} from './iamPolicyScope';
import { StatementCard } from './StatementCard';

const iamPolicySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(''),
  enabled: z.boolean(),
  documentVersion: z.string().min(1),
});

type IamPolicyFormValues = z.infer<typeof iamPolicySchema>;

export function IamPolicyEditorPage() {
  const { t } = useTranslation();
  const { data: catalogResp } = useApi<ActionCatalogResponse>(
    () => iamApi.getActionCatalog(),
    ['admin', 'iam', 'action-catalog', 'editor'],
  );
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isCreate = pathname === '/iam/policies/new';
  const { id: policyId } = useParams<{ id: string }>();
  const id = isCreate ? undefined : policyId;

  const { data: policy, loading, error, refetch } = useApi<IamPolicy>(
    () => iamApi.getPolicy(id!),
    ['admin', 'iam', 'policies', 'editor', id],
    { skip: !id },
  );

  const form = useZodForm<IamPolicyFormValues>({
    schema: iamPolicySchema,
    defaultValues: {
      name: '',
      description: '',
      enabled: true,
      documentVersion: DEFAULT_IAM_POLICY_VERSION,
    },
  });

  useUnsavedChangesWarning(form.formState.isDirty);

  const [statements, setStatements] = useState<StatementEntry[]>(() =>
    documentToStatements(null).statements,
  );
  const [viewMode, setViewMode] = useState<'form' | 'json'>('form');
  const [jsonText, setJsonText] = useState('');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const hydrateFromPolicy = useCallback((p: IamPolicy) => {
    form.reset({
      name: p.name,
      description: p.description ?? '',
      enabled: p.enabled,
      documentVersion: documentToStatements(p.document).version,
    });
    const { statements: stmts } = documentToStatements(p.document);
    setStatements(stmts);
    setJsonText(JSON.stringify(p.document, null, 2));
  }, [form]);

  useEffect(() => {
    if (policy) hydrateFromPolicy(policy);
  }, [policy, hydrateFromPolicy]);

  useEffect(() => {
    if (isCreate) {
      const { version, statements: stmts } = documentToStatements(null);
      form.setValue('documentVersion', version);
      setStatements(stmts);
      setJsonText(JSON.stringify(statementsToDocument(version, stmts), null, 2));
    }
  }, [isCreate]);

  const { mutate, loading: saving } = useMutation(
    (data: CreateIamPolicyInput | UpdateIamPolicyInput) =>
      id ? iamApi.updatePolicy(id, data) : iamApi.createPolicy(data as CreateIamPolicyInput),
    {
      onSuccess: () => {
        if (id) navigate(`/iam/policies/${id}`);
        else navigate('/iam/policies');
      },
      successMessage: id ? t('pages:iam.iamPolicyUpdated') : t('pages:iam.iamPolicyCreated'),
    },
  );

  const updateStatement = (index: number, field: keyof StatementEntry, value: string) => {
    setStatements((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    );
  };

  const addStatement = () => {
    setStatements((prev) => [
      ...prev,
      { sid: '', effect: 'Allow', actions: '', resources: '', conditionJson: '' },
    ]);
    // New statements expand by default so the user can fill them.
    setExpanded((prev) => [...prev, true]);
  };

  const removeStatement = (index: number) => {
    setStatements((prev) => prev.filter((_, i) => i !== index));
    setExpanded((prev) => prev.filter((_, i) => i !== index));
  };

  // Multi-statement ergonomics:
  // - Each statement card is collapsible; the header carries a summary so
  //   policies with 4+ statements stay scannable.
  // - ↑ / ↓ reorder swaps adjacent statements (no DnD library needed).
  // - Duplicate inserts a copy after the source, with sid suffixed _copy.
  //
  // `expanded` is a parallel array aligned with statements (index-by-index).
  // Initialized to all-collapsed for existing policies and single-expanded for
  // fresh-create flows. The useEffect below keeps it length-synced when
  // statements gets replaced wholesale (JSON parse, hydrate).
  const [expanded, setExpanded] = useState<boolean[]>([true]);

  useEffect(() => {
    setExpanded((prev) => {
      if (prev.length === statements.length) return prev;
      if (prev.length < statements.length) {
        return [...prev, ...new Array(statements.length - prev.length).fill(false)];
      }
      return prev.slice(0, statements.length);
    });
  }, [statements.length]);

  const toggleExpanded = (index: number) => {
    setExpanded((prev) => prev.map((v, i) => (i === index ? !v : v)));
  };

  // Per-statement catalog picker visibility. Single statement can have
  // the picker open at a time — clicking "Browse catalog" on another
  // statement closes the first.
  const [pickerOpenIdx, setPickerOpenIdx] = useState<number | null>(null);

  // Per-statement "intended scope" — the user can pick a resource type
  // from the dropdown on an empty statement to open a scoped picker
  // before any actions exist. Once they tick checkboxes, the inferred
  // mode (from actions) takes over and this map entry becomes
  // redundant. Keyed by statement index; survives reorder via the
  // parallel-array pattern used for `expanded`.
  const [intendedScopes, setIntendedScopes] = useState<Array<string | undefined>>([]);

  useEffect(() => {
    setIntendedScopes((prev) => {
      if (prev.length === statements.length) return prev;
      if (prev.length < statements.length) {
        return [...prev, ...new Array(statements.length - prev.length).fill(undefined)];
      }
      return prev.slice(0, statements.length);
    });
  }, [statements.length]);

  // Service select setter — sets the top-level scope. Picking a real
  // service moves to service-only state (Resource select shows next);
  // picking wildcard / mixed clears the resource dimension.
  const setServiceScope = (idx: number, value: string) => {
    if (value === SCOPE_PICK) {
      setIntendedScopes((prev) => prev.map((v, i) => (i === idx ? undefined : v)));
      return;
    }
    if (value === SCOPE_WILDCARD) {
      setIntendedScopes((prev) => prev.map((v, i) => (i === idx ? SCOPE_WILDCARD : v)));
      updateStatement(idx, 'actions', 'admin:*');
      return;
    }
    if (value === SCOPE_MIXED) {
      setIntendedScopes((prev) => prev.map((v, i) => (i === idx ? SCOPE_MIXED : v)));
      // Don't touch actions — preserve user work for chip-input editing.
      return;
    }
    if (isService(value)) {
      // Service picked but no resource yet — wait for the second select.
      // Clear actions so the next scoped picker starts fresh; preserve
      // resources field (user may have a useful NRN typed).
      setIntendedScopes((prev) => prev.map((v, i) => (i === idx ? SCOPE_SVC_PREFIX + value : v)));
      updateStatement(idx, 'actions', '');
      return;
    }
  };

  // Resource select setter — visible only when a real service is
  // picked. Drives the third level (action picker dispatch).
  //   '' (pick)       → back to service-only (Resource select stays open)
  //   '*' (all)       → service-wildcard, actions = admin:*, suggest service NRN
  //   resource name   → scoped(resource), suggest service+resource NRN
  // Auto-fills the Resource NRN field only when empty so user input
  // is not stomped.
  const setResourceScope = (idx: number, value: string) => {
    const current = computeSelectedScope(statements[idx], intendedScopes[idx], catalogResp);
    // Determine the service from current selection state.
    let service: ServiceName | undefined;
    if (current.kind === 'service' || current.kind === 'service-wildcard' || current.kind === 'resource') {
      service = current.service;
    }
    if (!service) return; // shouldn't happen — Resource select is hidden in other modes
    if (value === SCOPE_PICK) {
      setIntendedScopes((prev) => prev.map((v, i) => (i === idx ? SCOPE_SVC_PREFIX + service : v)));
      updateStatement(idx, 'actions', '');
      return;
    }
    if (value === RESOURCE_ALL) {
      setIntendedScopes((prev) => prev.map((v, i) => (i === idx ? SCOPE_SVC_ALL_PREFIX + service : v)));
      updateStatement(idx, 'actions', 'admin:*');
      if (!statements[idx].resources.trim()) {
        updateStatement(idx, 'resources', `nrn:nexus:${service}:*:*/*`);
      }
      return;
    }
    // Specific resource (catalog row).
    setIntendedScopes((prev) => prev.map((v, i) => (i === idx ? value : v)));
    updateStatement(idx, 'actions', '');
    if (!statements[idx].resources.trim()) {
      updateStatement(idx, 'resources', `nrn:nexus:${service}:*:${value}/*`);
    }
  };

  const moveStatement = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= statements.length) return;
    setStatements((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setExpanded((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const duplicateStatement = (index: number) => {
    setStatements((prev) => {
      const src = prev[index];
      const copy: StatementEntry = {
        ...src,
        sid: src.sid ? `${src.sid}_copy` : '',
      };
      return [...prev.slice(0, index + 1), copy, ...prev.slice(index + 1)];
    });
    // Duplicate starts expanded (user wants to tweak it).
    setExpanded((prev) => [...prev.slice(0, index + 1), true, ...prev.slice(index + 1)]);
  };

  const documentVersion = form.watch('documentVersion');

  const getDocumentFromForm = useCallback((): Record<string, unknown> | null => {
    for (const s of statements) {
      if (s.conditionJson.trim()) {
        try {
          JSON.parse(s.conditionJson);
        } catch (e) {
          setValidationErrors([`Condition JSON: ${(e as Error).message}`]);
          return null;
        }
      }
    }
    return statementsToDocument(documentVersion, statements);
  }, [documentVersion, statements]);

  const switchToJson = () => {
    const doc = getDocumentFromForm();
    if (!doc) return;
    const v = validateIamPolicyDocument(doc);
    if (!v.valid) {
      setValidationErrors(v.errors);
      return;
    }
    setValidationErrors([]);
    setJsonText(JSON.stringify(doc, null, 2));
    setViewMode('json');
  };

  const switchToForm = () => {
    const parsed = parsePolicyDocumentJson(jsonText);
    if (!parsed.ok) {
      setValidationErrors(parsed.errors);
      return;
    }
    const { version, statements: stmts } = documentToStatements(parsed.document);
    form.setValue('documentVersion', version);
    setStatements(stmts);
    setValidationErrors([]);
    setViewMode('form');
  };

  const formatJson = () => {
    try {
      const p = JSON.parse(jsonText);
      setJsonText(JSON.stringify(p, null, 2));
      setValidationErrors([]);
    } catch (e) {
      setValidationErrors([(e as Error).message]);
    }
  };

  const handleSubmit = () => {
    const values = form.getValues();
    let document: Record<string, unknown>;
    if (viewMode === 'json') {
      const parsed = parsePolicyDocumentJson(jsonText);
      if (!parsed.ok) {
        setValidationErrors(parsed.errors);
        return;
      }
      document = parsed.document;
    } else {
      const doc = getDocumentFromForm();
      if (!doc) return;
      const v = validateIamPolicyDocument(doc);
      if (!v.valid) {
        setValidationErrors(v.errors);
        return;
      }
      document = doc;
    }

    setValidationErrors([]);
    mutate({
      name: values.name,
      description: values.description,
      document: document as unknown as IamPolicyDocument,
      ...(id ? { enabled: values.enabled } : {}),
    });
  };

  const goBack = () => {
    if (id) navigate(`/iam/policies/${id}`);
    else navigate('/iam/policies');
  };

  const name = form.watch('name');
  const enabled = form.watch('enabled');

  // Live JSON preview alongside the Form editor. The preview reflects the
  // current statements + documentVersion in real time so the user can see
  // the policy document without flipping to the JSON tab.
  const jsonPreviewText = useMemo(() => {
    try {
      const doc = statementsToDocument(documentVersion || DEFAULT_IAM_POLICY_VERSION, statements);
      return JSON.stringify(doc, null, 2);
    } catch {
      return '';
    }
  }, [statements, documentVersion]);

  const copyJsonPreview = useCallback(() => {
    if (jsonPreviewText) {
      navigator.clipboard.writeText(jsonPreviewText).catch(() => {});
    }
  }, [jsonPreviewText]);

  // Catalog-derived autocomplete sources for the chip inputs.
  // actionSuggestions = every admin:<resource>.<verb> in the catalog +
  //   the common wildcards.
  // nrnSuggestions    = every canonical NRN wildcard from the catalog +
  //   the global "match everything" wildcard.
  const actionSuggestions = useMemo(() => {
    const out = new Set<string>(['admin:*', 'admin:*.read']);
    for (const r of catalogResp?.resources ?? []) {
      out.add(`admin:${r.type}.*`);
      for (const a of r.actions) out.add(a.name);
    }
    return [...out].sort();
  }, [catalogResp]);
  const nrnSuggestions = useMemo(() => {
    const out = new Set<string>(['nrn:nexus:*:*:*/*']);
    for (const r of catalogResp?.resources ?? []) out.add(r.nrn);
    return [...out].sort();
  }, [catalogResp]);

  // Description is rare; collapse it behind an "+ Add description" link
  // by default so it doesn't dominate the metadata strip. Auto-expand
  // when the persisted policy already has one (edit mode).
  const description = form.watch('description');
  const [showDescription, setShowDescription] = useState(false);
  useEffect(() => {
    if (description && description.trim().length > 0) setShowDescription(true);
  }, [description]);

  if (!isCreate && id && loading) return <LoadingSpinner />;
  if (!isCreate && id && error) return <ErrorBanner message={error.message} onRetry={refetch} />;
  if (!isCreate && id && !policy) return null;
  if (!isCreate && policy?.type === 'managed') {
    return (
      <Stack gap="md">
        <Breadcrumb items={[
          { label: t('pages:iam.iamPolicies'), to: '/iam/policies' },
          { label: policy?.name ?? '' },
        ]} />
        <ErrorBanner message={t('pages:iam.managedCannotBeEdited')} />
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Breadcrumb items={[
        { label: t('pages:iam.iamPolicies'), to: '/iam/policies' },
        { label: id ? t('pages:iam.editIamPolicy') : t('pages:iam.createIamPolicy') },
      ]} />

      {/* Sticky bar — title + always-visible Cancel/Save. The form is
          long once you add multiple statements; without this users had
          to scroll all the way down to find Save (the most-frequent
          affordance on this page). */}
      <div className={styles.stickyActionBar}>
        <div className={styles.stickyActionBarLeft}>
          <PageHeader
            title={id ? t('pages:iam.editIamPolicy') : t('pages:iam.createIamPolicy')}
            subtitle={t('pages:iam.policyEditorSubtitle')}
          />
        </div>
        <div className={styles.stickyActionBarRight}>
          {validationErrors.length > 0 ? (
            <span className={styles.validationBadgeError} role="status">
              {t('pages:iam.validationErrorsCount', { count: validationErrors.length })}
            </span>
          ) : (
            <span className={styles.validationBadgeOk} role="status">✓ {t('pages:iam.valid')}</span>
          )}
          <Button variant="secondary" onClick={goBack}>{t('common:cancel')}</Button>
          <Button onClick={handleSubmit} disabled={saving || !name.trim()}>
            {saving ? t('pages:iam.saving') : t('common:save')}
          </Button>
        </div>
      </div>

      {/* Metadata strip — Name + Document version packed horizontally;
          enabled switch only in edit mode. Description default-hidden
          behind an opt-in link. */}
      <Stack gap="sm">
        <div className={id ? styles.metaStripWithSwitch : styles.metaStrip}>
          <FormInput form={form} name="name" label={t('pages:iam.name')} required placeholder={t('pages:iam.placeholderPolicyName')} />
          <FormInput form={form} name="documentVersion" label={t('pages:iam.documentVersion')} placeholder={DEFAULT_IAM_POLICY_VERSION} />
          {id && (
            <FormField label={t('common:enabled')}>
              <Switch checked={enabled} onCheckedChange={(v) => form.setValue('enabled', v)} />
            </FormField>
          )}
        </div>
        {showDescription ? (
          <FormInput form={form} name="description" label={t('pages:iam.description')} placeholder={t('pages:iam.placeholderOptionalDescription')} />
        ) : (
          <button type="button" className={styles.addDescriptionLink} onClick={() => setShowDescription(true)}>
            + {t('pages:iam.addDescription')}
          </button>
        )}
      </Stack>

      {/* Editor body — 2-col (form + live JSON preview) in form mode;
          single full-width pane in JSON edit mode. */}
      <div className={viewMode === 'form' ? styles.policyTwoCol : ''}>
      <Card className={styles.editorSection}>
        <Stack direction="horizontal" gap="md" className={editorStyles.toolbarBetween}>
          <Stack direction="horizontal" gap="sm" className={editorStyles.toolbarCenter}>
            <span className={styles.editorSectionTitle}>{t('pages:iam.policyDocument')}</span>
            <Tooltip content={t('pages:iam.policyDocumentTooltip')}>
              <span className={editorStyles.tooltipIcon}>&#x24D8;</span>
            </Tooltip>
          </Stack>
          <Stack direction="horizontal" gap="xs" className={editorStyles.toolbarWrap}>
            <button
              type="button"
              onClick={() => { if (viewMode !== 'form') switchToForm(); }}
              className={viewMode === 'form' ? styles.viewToggleActive : styles.viewToggleInactive}
            >
              {t('pages:iam.formView')}
            </button>
            <button
              type="button"
              onClick={() => { if (viewMode !== 'json') switchToJson(); }}
              className={viewMode === 'json' ? styles.viewToggleActive : styles.viewToggleInactive}
            >
              {t('pages:iam.jsonView')}
            </button>
            {viewMode === 'json' && (
              <Button variant="secondary" size="sm" onClick={formatJson}>{t('pages:iam.formatJson')}</Button>
            )}
          </Stack>
        </Stack>

        {validationErrors.length > 0 && (
          <div role="alert" className={styles.validationErrors}>
            <strong className={editorStyles.validationTitle}>{t('pages:iam.validation')}</strong>
            <ul className={editorStyles.validationList}>
              {validationErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {viewMode === 'json' && (
          <div>
            <Stack direction="horizontal" gap="xs" className={editorStyles.jsonLabelRow}>
              <span className={editorStyles.jsonLabelText}>{t('pages:iam.policyJson')}</span>
              <Tooltip content={t('pages:iam.policyJsonTooltip')}>
                <span className={editorStyles.tooltipIcon}>&#x24D8;</span>
              </Tooltip>
            </Stack>
            <textarea
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value);
                setValidationErrors([]);
              }}
              rows={24}
              spellCheck={false}
              aria-label={t('pages:iam.ariaPolicyDocumentJson')}
              className={editorStyles.jsonTextarea}
            />
          </div>
        )}

        {viewMode === 'form' && statements.map((stmt, idx) => (
          <StatementCard
            key={idx}
            stmt={stmt}
            idx={idx}
            statementsCount={statements.length}
            isExpanded={expanded[idx] ?? true}
            intendedScope={intendedScopes[idx]}
            pickerOpen={pickerOpenIdx === idx}
            catalogResp={catalogResp}
            actionSuggestions={actionSuggestions}
            nrnSuggestions={nrnSuggestions}
            onToggleExpand={() => toggleExpanded(idx)}
            onMove={(dir) => moveStatement(idx, dir)}
            onDuplicate={() => duplicateStatement(idx)}
            onRemove={() => removeStatement(idx)}
            onUpdate={(field, value) => updateStatement(idx, field, value)}
            onServiceScope={(value) => setServiceScope(idx, value)}
            onResourceScope={(value) => setResourceScope(idx, value)}
            onTogglePicker={() => setPickerOpenIdx((cur) => (cur === idx ? null : idx))}
            onClosePicker={() => setPickerOpenIdx(null)}
          />
        ))}

        {viewMode === 'form' && (
          <Button variant="secondary" size="sm" onClick={addStatement}>+ {t('pages:iam.addStatement')}</Button>
        )}
      </Card>

      {/* Live JSON preview — sticky on the right column. Hidden when
          the user enters JSON edit mode (the editor goes full-width
          then). */}
      {viewMode === 'form' && (
        <aside className={styles.jsonPreviewCard} aria-label={t('pages:iam.jsonPreviewAria')}>
          <div className={styles.jsonPreviewHeader}>
            <span className={styles.jsonPreviewTitle}>{t('pages:iam.jsonPreview')}</span>
            <Button variant="secondary" size="sm" onClick={copyJsonPreview}>{t('pages:iam.copy')}</Button>
          </div>
          <pre className={styles.jsonPreviewBody}>{jsonPreviewText}</pre>
        </aside>
      )}
      </div>
    </Stack>
  );
}
