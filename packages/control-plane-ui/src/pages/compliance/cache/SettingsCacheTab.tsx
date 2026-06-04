/**
 * Prompt Cache 3-Tier Config global page.
 *
 * Page layout:
 *   1. Global Defaults panel        — Tier 1 (normaliser_enabled + cache_master_kill_switch).
 *   2. Adapter Defaults panel       — Tier 2 knobs for the 4 adapter families that have
 *                                     family-specific cache configuration (anthropic, bedrock,
 *                                     gemini, vertex). OpenAI-compat adapters have no
 *                                     adapter-level knobs, so they are intentionally absent
 *                                     from this panel's tab strip.
 *   3. Normalisation rules panel    — flat table of every bundled rule across every adapter
 *                                     family, grouped by adapter, with toggles. Source of truth
 *                                     for `BUNDLED_RULES` is `packages/shared/normaliser/bundled.go`.
 *   4. Active Overrides panel       — Tier-3 listing.
 */
import { Stack } from '@/components/ui';
import { GlobalPanel } from './GlobalPanel';
import { AdapterPanel } from './AdapterPanel';
import { NormalisationRulesPanel } from './NormalisationRulesPanel';
import { OverridesPanel } from './OverridesPanel';

export function SettingsCacheTab() {
  return (
    <Stack gap="lg">
      <GlobalPanel />
      <AdapterPanel />
      <NormalisationRulesPanel />
      <OverridesPanel />
    </Stack>
  );
}
