import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/context/ToastContext';
import { Button, FormField, Dialog, Textarea } from '@/components/ui';
import { prewarm as prewarmApi } from '@/api/services/cache/semanticPrewarm';
import type { PrewarmEntry, PrewarmResult } from '@/api/services/cache/semanticPrewarm';
import { parseCorpus, validateCorpus } from './prewarmCorpus';
import styles from '../CachePage.module.css';

interface PrewarmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Bulk pre-warm modal for the semantic cache. Self-contained: owns its corpus
 * text / parse / validate / dry-run / commit state. Resets every time it opens.
 */
export function PrewarmModal({ open, onOpenChange }: PrewarmModalProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();

  const [prewarmText, setPrewarmText] = useState('');
  const [prewarmParseError, setPrewarmParseError] = useState<string | null>(null);
  const [prewarmValidationErrors, setPrewarmValidationErrors] = useState<string[]>([]);
  const [prewarmParsed, setPrewarmParsed] = useState<PrewarmEntry[] | null>(null);
  const [prewarmDryRunResult, setPrewarmDryRunResult] = useState<PrewarmResult | null>(null);
  const [prewarmLoading, setPrewarmLoading] = useState(false);
  const [prewarmProgress, setPrewarmProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset to a clean slate each time the modal opens (matches the previous
  // handlePrewarmOpen reset-then-open behavior).
  useEffect(() => {
    if (open) {
      setPrewarmText('');
      setPrewarmParseError(null);
      setPrewarmValidationErrors([]);
      setPrewarmParsed(null);
      setPrewarmDryRunResult(null);
      setPrewarmProgress(0);
    }
  }, [open]);

  const handlePrewarmTextChange = useCallback((value: string) => {
    setPrewarmText(value);
    setPrewarmParseError(null);
    setPrewarmValidationErrors([]);
    setPrewarmParsed(null);
    setPrewarmDryRunResult(null);
  }, []);

  const handlePrewarmFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result;
      if (typeof text === 'string') {
        setPrewarmText(text);
        setPrewarmParseError(null);
        setPrewarmValidationErrors([]);
        setPrewarmParsed(null);
        setPrewarmDryRunResult(null);
      }
    };
    reader.readAsText(file);
  }, []);

  const parseAndValidate = useCallback((): PrewarmEntry[] | null => {
    setPrewarmParseError(null);
    setPrewarmValidationErrors([]);
    let parsed: PrewarmEntry[];
    try {
      parsed = parseCorpus(prewarmText);
    } catch (err) {
      setPrewarmParseError(err instanceof Error ? err.message : String(err));
      return null;
    }
    const errors = validateCorpus(parsed);
    if (errors.length > 0) {
      setPrewarmValidationErrors(errors);
      return null;
    }
    return parsed;
  }, [prewarmText]);

  const handlePrewarmPreview = useCallback(async () => {
    const entries = parseAndValidate();
    if (!entries) return;
    setPrewarmParsed(entries);
    setPrewarmLoading(true);
    setPrewarmProgress(10);
    setPrewarmDryRunResult(null);
    try {
      const result = await prewarmApi({ entries, dryRun: true });
      setPrewarmDryRunResult(result);
      setPrewarmProgress(100);
    } catch {
      setPrewarmParseError(t('pages:aiGateway.cache.prewarm.errorToast'));
    } finally {
      setPrewarmLoading(false);
    }
  }, [parseAndValidate, t]);

  const handlePrewarmConfirm = useCallback(async () => {
    const entries = prewarmParsed ?? parseAndValidate();
    if (!entries) return;
    setPrewarmLoading(true);
    setPrewarmProgress(5);
    setPrewarmDryRunResult(null);
    try {
      await prewarmApi({ entries, dryRun: false });
      setPrewarmProgress(100);
      addToast(t('pages:aiGateway.cache.prewarm.successToast'), 'success');
      onOpenChange(false);
    } catch {
      setPrewarmParseError(t('pages:aiGateway.cache.prewarm.errorToast'));
      setPrewarmProgress(0);
    } finally {
      setPrewarmLoading(false);
    }
  }, [prewarmParsed, parseAndValidate, addToast, t, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('pages:aiGateway.cache.prewarm.modalTitle')}
      size="lg"
    >
      <div className={styles.prewarmModalBody}>
        <FormField label={t('pages:aiGateway.cache.prewarm.jsonLabel')}>
          <Textarea
            className={styles.prewarmTextarea}
            value={prewarmText}
            onChange={(e) => handlePrewarmTextChange(e.target.value)}
            placeholder={t('pages:aiGateway.cache.prewarm.jsonPlaceholder')}
            disabled={prewarmLoading}
            rows={8}
          />
        </FormField>

        <div className={styles.prewarmFileRow}>
          <span>{t('pages:aiGateway.cache.prewarm.csvFileLabel')}</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.csv"
            className={styles.prewarmFileInput}
            onChange={handlePrewarmFileChange}
            disabled={prewarmLoading}
          />
        </div>

        {(prewarmParseError || prewarmValidationErrors.length > 0) && (
          <div role="alert" className={styles.prewarmValidationErrors}>
            {prewarmParseError && <div>{prewarmParseError}</div>}
            {prewarmValidationErrors.length > 0 && (
              <ul className={styles.prewarmValidationList}>
                {prewarmValidationErrors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {prewarmLoading && (
          <div className={styles.prewarmProgressRow}>
            <span className={styles.prewarmProgressLabel}>
              {t('pages:aiGateway.cache.prewarm.progressLabel')}
            </span>
            <div className={styles.prewarmProgressBar}>
              <div
                className={styles.prewarmProgressFill}
                style={{ width: `${prewarmProgress}%` }}
              />
            </div>
          </div>
        )}

        {prewarmDryRunResult !== null && !prewarmLoading && (
          <div className={styles.prewarmPreview}>
            <p className={styles.prewarmPreviewTitle}>
              {t('pages:aiGateway.cache.prewarm.plannedWritesLabel')}
            </p>
            <div className={styles.prewarmPreviewGrid}>
              <span className={styles.prewarmPreviewLabel}>
                {t('pages:aiGateway.cache.prewarm.previewEntries')}
              </span>
              <span className={styles.prewarmPreviewValue}>{prewarmParsed?.length ?? 0}</span>

              <span className={styles.prewarmPreviewLabel}>
                {t('pages:aiGateway.cache.prewarm.previewEmbedCalls')}
              </span>
              <span className={styles.prewarmPreviewValue}>
                {prewarmDryRunResult.embeddingsCalls}
              </span>

              <span className={styles.prewarmPreviewLabel}>
                {t('pages:aiGateway.cache.prewarm.previewCost')}
              </span>
              <span className={styles.prewarmPreviewValue}>
                {t('pages:aiGateway.cache.prewarm.previewCostValue', {
                  cost: prewarmDryRunResult.embeddingCostUsd.toFixed(4),
                })}
              </span>

              <span className={styles.prewarmPreviewLabel}>
                {t('pages:aiGateway.cache.prewarm.previewDuration')}
              </span>
              <span className={styles.prewarmPreviewValue}>
                {t('pages:aiGateway.cache.prewarm.previewDurationValue', {
                  ms: prewarmDryRunResult.durationMs,
                })}
              </span>
            </div>
          </div>
        )}

        <div className={styles.prewarmModalActions}>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={prewarmLoading}
          >
            {t('pages:aiGateway.cache.prewarm.cancelButton')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void handlePrewarmPreview()}
            loading={prewarmLoading && prewarmDryRunResult === null}
            disabled={!prewarmText.trim() || prewarmLoading}
          >
            {t('pages:aiGateway.cache.prewarm.previewButton')}
          </Button>
          <Button
            onClick={() => void handlePrewarmConfirm()}
            loading={prewarmLoading && prewarmDryRunResult !== null}
            disabled={!prewarmText.trim() || prewarmLoading}
          >
            {t('pages:aiGateway.cache.prewarm.confirmButton')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
