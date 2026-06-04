import type { AppliedConfigEntry } from '@/api/services/infrastructure/nodes/hub';

/**
 * Mirrors `configtypes.IsBlacklisted` on the Go side (the unexported
 * `nonOverridableConfigKeys` map). Keep these two lists in sync — the server
 * enforces the policy, the UI uses the list to pre-emptively grey out the row
 * + disable the override action.
 */
export const NON_OVERRIDABLE: ReadonlySet<string> = new Set(['credentials', 'virtual_keys']);

export type EditorState = { mode: 'add' | 'edit'; configKey: string };

export function renderJson(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return JSON.stringify(value, null, 2);
}

export function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Detects an active override on `killswitch` whose state turns the killswitch
 * off. Used to render the bypass banner. We treat any payload whose
 * `engaged === false` as a deliberate disable; everything else (including a
 * missing field) is left to the server's policy semantics.
 */
export function detectKillswitchBypass(entry: AppliedConfigEntry | undefined): boolean {
  if (!entry || !entry.override) return false;
  const state = entry.override.state as { engaged?: unknown } | null | undefined;
  return state !== null && typeof state === 'object' && state.engaged === false;
}
