import { z } from 'zod';
import type { HookImplementationSummary } from '@/api/types';
import {
  HOOK_APPLICABLE_INGRESS,
  HOOK_APPLICABLE_INGRESS_ORDER,
  HOOK_CATEGORY_AUTO_VALUE,
  HOOK_ROW_TYPE,
} from '@/constants/hooks';

/**
 * Radix Select treats value="" as "no selection". Use a sentinel for the
 * "auto" category so Radix treats it as a real selected value.
 */
export const CATEGORY_AUTO_SENTINEL = '__auto__';
export const toCategorySentinel = (v: string) =>
  v === HOOK_CATEGORY_AUTO_VALUE ? CATEGORY_AUTO_SENTINEL : v;
export const fromCategorySentinel = (v: string) =>
  v === CATEGORY_AUTO_SENTINEL ? HOOK_CATEGORY_AUTO_VALUE : v;
export const INGRESS_ALLOWED = new Set<string>(HOOK_APPLICABLE_INGRESS_ORDER);

export function normalizeApplicableIngress(
  nextRaw: string[] | undefined,
  prevRaw?: string[],
): string[] {
  const all = HOOK_APPLICABLE_INGRESS.ALL;
  const canonicalize = (codes?: string[]) =>
    Array.from(new Set(
      (codes ?? [])
        .map((code) => {
          const normalized = (code ?? '').trim().toUpperCase();
          return INGRESS_ALLOWED.has(normalized) ? normalized : '';
        })
        .filter(Boolean),
    ));

  const next = canonicalize(nextRaw);
  const prev = canonicalize(prevRaw);
  const hadAll = prev.includes(all);
  const hasAll = next.includes(all);
  const specifics = next.filter((code) => code !== all);

  if (hasAll && specifics.length > 0) {
    // User selected ALL from a specific subset: ALL wins.
    if (!hadAll) return [all];
    // User selected a specific ingress while ALL was active: specific wins.
    return specifics;
  }
  if (hasAll) return [all];
  if (specifics.length > 0) return specifics;
  // Keep a valid non-empty value aligned with backend default semantics.
  return [all];
}

export function asConfigRecord(cfg: unknown): Record<string, unknown> {
  if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) return cfg as Record<string, unknown>;
  return {};
}

export function implementationsForRow(
  list: HookImplementationSummary[],
  rowType: string,
  stage: string,
): HookImplementationSummary[] {
  return list.filter((impl) => {
    if (!impl.supportedStages.includes(stage)) return false;
    if (rowType === HOOK_ROW_TYPE.WEBHOOK) return impl.implementationId === 'webhook.forward';
    if (rowType === HOOK_ROW_TYPE.SCRIPT) return impl.implementationId === 'noop';
    return impl.implementationId !== 'webhook.forward';
  });
}

export const hookFormSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  stage: z.string().min(1),
  priority: z.coerce.number().int(),
  timeoutMs: z.coerce.number().int().min(0),
  failBehavior: z.string().min(1),
  enabled: z.boolean(),
  category: z.string(),
  whEndpoint: z.string().optional().default(''),
});

export type HookFormValues = z.infer<typeof hookFormSchema>;
export type WebhookTargetOption = 'custom' | 'aiguard';
