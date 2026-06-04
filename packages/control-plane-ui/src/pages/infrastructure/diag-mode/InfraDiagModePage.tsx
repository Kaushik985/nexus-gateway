/**
 * InfraDiagModePage — Agent Diagnostic Mode admin view.
 *
 * Two-section layout (per spec §11.4):
 *
 *   1. Active windows — table of `thing_diag_mode_window` rows with
 *      `endedAt > now()`, polled every 10 s. Each row exposes a "Disable"
 *      action gated behind a confirm dialog.
 *
 *   2. Bulk enable form — filter (thingIds + agentVersion + os) plus a
 *      window/reason combo. The user clicks "Resolve preview" first, which
 *      lists agents and applies the filter client-side so the operator sees
 *      the exact match count before committing. The CP server caps the
 *      filter at 500 ids; the UI duplicates that gate so we never POST a
 *      request the server is going to 400.
 *
 * Bulk semantics: the CP returns 207 Multi-Status when one or more per-thing
 * enables fail. The shared `useMutation` toast surfaces a single message,
 * so we drive the bulk action with a manual `try { bulk() }` instead and
 * render a per-item result panel reflecting the `items[i].ok` array.
 *
 * Why a client-side preview rather than a server "dryRun":
 *   The CP bulk handler does not expose a dry-run mode today. Replicating
 *   the filter against `/api/admin/nodes?type=agent` keeps the API surface
 *   stable and bounded — agent fleets cap in the low thousands and we only
 *   show a count, never the full list, so memory stays modest.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '@/hooks/useApi';
import { useMutation } from '@/hooks/useMutation';
import { diagModeApi } from '@/api/services/infrastructure/diag/diagmode';
import type {
  BulkDiagModeResult,
  DiagModeWindow,
} from '@/api/services/infrastructure/diag/diagmode';
import { hubApi } from '@/api/services/infrastructure/nodes/hub';
import { PageHeader, Stack, AlertDialog } from '@/components/ui';
import {
  REFRESH_INTERVAL_MS,
  MAX_BULK_THINGS,
  WINDOW_OPTIONS,
  applyFilter,
  parseThingIds,
} from './diagModeHelpers';
import { ActiveWindowsSection } from './ActiveWindowsSection';
import { BulkEnableSection } from './BulkEnableSection';
import { ResultPanels } from './ResultPanels';

export default function InfraDiagModePage() {
  const { t } = useTranslation('pages');

  // ── Active windows ──
  const activeWindows = useApi<DiagModeWindow[]>(
    () => diagModeApi.list(),
    ['admin', 'diag-mode', 'active'],
  );

  // Poll every 10 s. We piggy-back on `refetch` rather than configuring
  // refetchInterval in useApi so the cadence stays scoped to this page.
  useEffect(() => {
    const id = window.setInterval(() => activeWindows.refetch(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [confirmDisable, setConfirmDisable] = useState<DiagModeWindow | null>(null);

  const disableMutation = useMutation<string, unknown>(
    (thingId: string) => diagModeApi.disable(thingId),
    {
      successMessage: t('infrastructure.diagMode.disableSuccess'),
      errorMessage: t('infrastructure.diagMode.disableFailed'),
      invalidateQueries: [['admin', 'diag-mode', 'active']],
      onSuccess: () => activeWindows.refetch(),
    },
  );

  const handleConfirmDisable = () => {
    const target = confirmDisable;
    setConfirmDisable(null);
    if (target) {
      disableMutation.mutate(target.nodeId).catch(() => undefined);
    }
  };

  // ── Bulk enable form state ──
  const [agentVersion, setAgentVersion] = useState<string>('');
  const [os, setOs] = useState<string>('');
  const [thingIdsRaw, setThingIdsRaw] = useState<string>('');
  const [windowKey, setWindowKey] = useState<string>('1h');
  const [reason, setReason] = useState<string>('');

  const [previewIds, setPreviewIds] = useState<string[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [bulkResult, setBulkResult] = useState<BulkDiagModeResult | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  // Pasted thingIds parsed once per change. When non-empty the other filter
  // dropdowns are ignored (matches server behavior).
  const parsedThingIds = useMemo(() => parseThingIds(thingIdsRaw), [thingIdsRaw]);

  const previewCount = previewIds?.length ?? null;

  // Preview action: fetch agent list once and filter client-side.
  const handlePreview = async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    setBulkResult(null);
    setBulkError(null);
    try {
      const resp = await hubApi.listNodes({ type: 'agent', pageSize: 1000 });
      const filtered = applyFilter(
        resp.nodes ?? [],
        parsedThingIds,
        agentVersion,
        os,
      );
      setPreviewIds(filtered.map((n) => n.id));
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
      setPreviewIds(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Recompute preview on filter change to avoid stale counts. We lazily
  // re-run only when the user already pulled a preview at least once.
  useEffect(() => {
    if (previewIds !== null) {
      setPreviewIds(null);
      setBulkResult(null);
      setBulkError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentVersion, os, thingIdsRaw]);

  const validReason = reason.trim().length > 0;
  const validCount = previewCount !== null && previewCount > 0 && previewCount <= MAX_BULK_THINGS;

  const canSubmit = validCount && validReason && !bulkLoading;

  const handleBulkEnable = async () => {
    if (!canSubmit || previewCount === null) return;
    setBulkLoading(true);
    setBulkResult(null);
    setBulkError(null);
    try {
      const ms = WINDOW_OPTIONS.find((w) => w.value === windowKey)?.ms ?? 60 * 60 * 1000;
      const until = new Date(Date.now() + ms).toISOString();
      // When the operator pasted thing_ids we pass them verbatim — that's the
      // exact list the preview displayed, so the server resolves the same set
      // even if a node-list refetch would now return slightly different rows.
      const filter = parsedThingIds.length > 0
        ? { nodeIds: parsedThingIds }
        : { agentVersion: agentVersion || undefined, os: os || undefined };
      const result = await diagModeApi.bulk({
        filter,
        until,
        reason: reason.trim(),
      });
      setBulkResult(result);
      activeWindows.refetch();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkLoading(false);
    }
  };

  // ── Render ──
  const windows = activeWindows.data ?? [];

  return (
    <Stack gap="lg">
      <PageHeader
        title={t('infrastructure.diagMode.title')}
        subtitle={t('infrastructure.diagMode.description')}
      />

      <ActiveWindowsSection
        windows={windows}
        error={activeWindows.error}
        loading={activeWindows.loading}
        refetch={activeWindows.refetch}
        setConfirmDisable={setConfirmDisable}
      />

      <BulkEnableSection
        agentVersion={agentVersion}
        setAgentVersion={setAgentVersion}
        os={os}
        setOs={setOs}
        thingIdsRaw={thingIdsRaw}
        setThingIdsRaw={setThingIdsRaw}
        windowKey={windowKey}
        setWindowKey={setWindowKey}
        reason={reason}
        setReason={setReason}
        parsedThingIds={parsedThingIds}
        previewCount={previewCount}
        previewLoading={previewLoading}
        previewError={previewError}
        handlePreview={handlePreview}
        validReason={validReason}
        canSubmit={canSubmit}
        bulkLoading={bulkLoading}
        handleBulkEnable={handleBulkEnable}
      />

      <ResultPanels bulkResult={bulkResult} bulkError={bulkError} />

      {/* ── Disable confirm dialog ── */}
      <AlertDialog
        open={!!confirmDisable}
        onOpenChange={(open) => {
          if (!open) setConfirmDisable(null);
        }}
        title={t('infrastructure.diagMode.disableConfirmTitle')}
        description={t('infrastructure.diagMode.disableConfirmDesc', {
          thingId: confirmDisable?.nodeId ?? '',
        })}
        confirmLabel={t('infrastructure.diagMode.disable')}
        cancelLabel={t('infrastructure.diagMode.cancel')}
        onConfirm={handleConfirmDisable}
        variant="danger"
      />
    </Stack>
  );
}
