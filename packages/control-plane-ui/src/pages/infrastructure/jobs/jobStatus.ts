import { statusToVariant } from '@/components/ui';

// Maps a scheduled-job status to a Badge variant. Single source of truth shared
// by the Jobs list and the job detail page so a status always renders with the
// same color. Covers both the job-level lastStatus (ok / running / failed /
// interrupted) and a per-run status (running / success / error / skipped);
// anything else falls back to the generic status-to-variant mapping.
export function jobStatusVariant(status: string | undefined | null) {
  switch ((status ?? '').toLowerCase()) {
    case 'ok':
    case 'success':
      return 'success' as const;
    case 'running':
      return 'warning' as const;
    case 'failed':
    case 'error':
      return 'danger' as const;
    case 'interrupted':
    case 'skipped':
      return 'default' as const;
    default:
      return statusToVariant(status ?? '');
  }
}
