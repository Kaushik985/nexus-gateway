import {
  PASSTHROUGH_MAX_EXPIRY_HOURS,
  type PassthroughPayload,
  type PassthroughTier,
} from '@/api/services';

export type TierKind = 'global' | 'adapter' | 'provider';

export interface TierFormState {
  enabled: boolean;
  bypassHooks: boolean;
  bypassCache: boolean;
  bypassNormalize: boolean;
  expiresAt: string; // ISO local datetime-local input
  reason: string;
}

export const EMPTY_FORM: TierFormState = {
  enabled: false,
  bypassHooks: false,
  bypassCache: false,
  bypassNormalize: false,
  expiresAt: '',
  reason: '',
};

export function tierToForm(t: PassthroughTier | undefined): TierFormState {
  if (!t) return EMPTY_FORM;
  return {
    enabled: t.enabled,
    bypassHooks: t.bypassHooks,
    bypassCache: t.bypassCache,
    bypassNormalize: t.bypassNormalize,
    expiresAt: t.expiresAt ? toLocalInputValue(t.expiresAt) : '',
    reason: t.reason ?? '',
  };
}

/** Convert ISO to the `<input type="datetime-local">` value (no Z, no ms). */
export function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formToPayload(f: TierFormState): PassthroughPayload {
  return {
    enabled: f.enabled,
    bypassHooks: f.bypassHooks,
    bypassCache: f.bypassCache,
    bypassNormalize: f.bypassNormalize,
    expiresAt: f.enabled && f.expiresAt ? new Date(f.expiresAt).toISOString() : null,
    reason: f.reason,
  };
}

/** Default expiresAt for newly-enabled rows: NOW + 1 hour, rounded to the minute. */
export function defaultExpiresAt(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return toLocalInputValue(d.toISOString());
}

export function maxExpiresAt(): string {
  const d = new Date(Date.now() + PASSTHROUGH_MAX_EXPIRY_HOURS * 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return toLocalInputValue(d.toISOString());
}

export function emptyTier(): PassthroughTier {
  return {
    enabled: false,
    bypassHooks: false,
    bypassCache: false,
    bypassNormalize: false,
  };
}

export function bypassSummary(t: PassthroughTier): string {
  const flags: string[] = [];
  if (t.bypassHooks) flags.push('hooks');
  if (t.bypassCache) flags.push('cache');
  if (t.bypassNormalize) flags.push('normalize');
  return flags.length ? `[${flags.join(',')}]` : '';
}
