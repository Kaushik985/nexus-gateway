import { describe, it, expect } from 'vitest';
import {
  buildRoutingApiConfig, buildSmartConfig, parseSmartConfig,
  parseFallbackChain, buildFallbackChainApi, resolveProviderModelIds,
  emptyConditionalFormState, DEFAULT_SMART_SYSTEM_PROMPT,
} from '@/pages/ai-gateway/routing/_shared/routing-rule-config';
import type { AdminModelsByProvider } from '@/api/types';

const groups = [
  { provider: { id: 'p1', name: 'openai', enabled: true }, models: [
    { id: 'm1', providerModelId: 'gpt-4o', name: 'GPT-4o', enabled: true },
    { id: 'm2', providerModelId: 'gpt-4o-mini', name: 'Mini', enabled: true },
  ] },
] as unknown as AdminModelsByProvider[];
const entry = (provider: string, model: string, weight = '50') => ({ provider, model, weight }) as never;
const base = { providerGroups: groups, singleProvider: '', singleModel: '', entries: [] as never[], matchModelIds: [] as string[] };

describe('resolveProviderModelIds', () => {
  it('maps a provider name + providerModelId to the internal ids', () => {
    expect(resolveProviderModelIds(groups, 'openai', 'gpt-4o')).toEqual({ providerId: 'p1', modelId: 'm1' });
    expect(resolveProviderModelIds(groups, 'openai', 'nope')).toBeNull();
    expect(resolveProviderModelIds(groups, 'nope', 'gpt-4o')).toBeNull();
  });
});

describe('buildRoutingApiConfig', () => {
  it('single: resolves the chosen provider/model (and errors when unset)', () => {
    expect(buildRoutingApiConfig({ ...base, strategyType: 'single', singleProvider: 'openai', singleModel: 'gpt-4o' }))
      .toEqual({ ok: true, config: { type: 'single', providerId: 'p1', modelId: 'm1' } });
    expect(buildRoutingApiConfig({ ...base, strategyType: 'single' }).ok).toBe(false);
  });

  it('fallback: builds ordered single targets (and errors on empty)', () => {
    const r = buildRoutingApiConfig({ ...base, strategyType: 'fallback', entries: [entry('openai', 'gpt-4o'), entry('openai', 'gpt-4o-mini')] });
    expect(r).toEqual({ ok: true, config: { type: 'fallback', targets: [
      { type: 'single', providerId: 'p1', modelId: 'm1' }, { type: 'single', providerId: 'p1', modelId: 'm2' },
    ] } });
    expect(buildRoutingApiConfig({ ...base, strategyType: 'fallback' }).ok).toBe(false);
  });

  it('loadbalance: weighted targets, defaulting an invalid weight to 50', () => {
    const r = buildRoutingApiConfig({ ...base, strategyType: 'loadbalance', entries: [entry('openai', 'gpt-4o', '70'), entry('openai', 'gpt-4o-mini', 'NaN')] }) as { ok: true; config: { weightedTargets: { weight: number }[] } };
    expect(r.ok).toBe(true);
    expect(r.config.weightedTargets[0].weight).toBe(70);
    expect(r.config.weightedTargets[1].weight).toBe(50); // NaN → default
  });

  it('ab_split: per-target weights (and errors on empty)', () => {
    const r = buildRoutingApiConfig({ ...base, strategyType: 'ab_split', entries: [entry('openai', 'gpt-4o', '30')] }) as { ok: true; config: { type: string; targets: { weight: number }[] } };
    expect(r.config.type).toBe('ab_split');
    expect(r.config.targets[0].weight).toBe(30);
    expect(buildRoutingApiConfig({ ...base, strategyType: 'ab_split' }).ok).toBe(false);
  });

  it('conditional: returns a preserved valid config as-is', () => {
    const preserved = { type: 'conditional', conditions: [], default: { type: 'single' } };
    expect(buildRoutingApiConfig({ ...base, strategyType: 'conditional', preservedConditionalConfig: preserved }))
      .toEqual({ ok: true, config: preserved });
  });

  it('conditional: builds a when-clause from matchModelIds when no form/preserved config', () => {
    const r = buildRoutingApiConfig({ ...base, strategyType: 'conditional', matchModelIds: ['m1'] }) as { ok: true; config: { type: string; conditions: { when: unknown }[] } };
    expect(r.ok).toBe(true);
    expect(r.config.type).toBe('conditional');
    expect(r.config.conditions[0].when).toEqual({ 'requestedModel.id': { $eq: 'm1' } });
  });

  it('conditional: prefers the structured form when supplied', () => {
    const form = { ...emptyConditionalFormState(), defaultProvider: 'openai', defaultModel: 'gpt-4o' };
    const r = buildRoutingApiConfig({ ...base, strategyType: 'conditional', conditionalForm: form });
    expect(r.ok).toBe(true);
  });

  it('smart routes callers to buildSmartConfig; unknown strategy errors', () => {
    expect(buildRoutingApiConfig({ ...base, strategyType: 'smart' }).ok).toBe(false);
    expect(buildRoutingApiConfig({ ...base, strategyType: 'bogus' as never }).ok).toBe(false);
  });
});

describe('buildSmartConfig + parseSmartConfig', () => {
  const sform = { routerProvider: 'openai', routerModel: 'gpt-4o', systemPrompt: 'route well', temperature: '0.2', maxTokens: '2048', timeoutMs: '5000', defaultProvider: 'openai', defaultModel: 'gpt-4o-mini' };

  it('build: maps router + default + numeric coercion', () => {
    const r = buildSmartConfig(sform, groups) as { ok: true; config: Record<string, unknown> };
    expect(r.ok).toBe(true);
    expect(r.config).toMatchObject({ type: 'smart', routerProviderId: 'p1', routerModelId: 'm1', temperature: 0.2, maxTokens: 2048, timeoutMs: 5000, defaultProviderId: 'p1', defaultModelId: 'm2' });
  });

  it('build: errors without a router, or with an empty system prompt', () => {
    expect(buildSmartConfig({ ...sform, routerProvider: '', routerModel: '' }, groups).ok).toBe(false);
    expect(buildSmartConfig({ ...sform, systemPrompt: '  ' }, groups).ok).toBe(false);
  });

  it('parse: non-smart config yields the empty defaults; a smart config round-trips the router', () => {
    expect(parseSmartConfig({ type: 'single' }, groups).systemPrompt).toBe(DEFAULT_SMART_SYSTEM_PROMPT);
    const parsed = parseSmartConfig({ type: 'smart', routerProviderId: 'p1', routerModelId: 'm1', systemPrompt: 'x', temperature: 0.5 }, groups);
    expect(parsed.routerProvider).toBe('openai');
    expect(parsed.routerModel).toBe('gpt-4o');
    expect(parsed.temperature).toBe('0.5');
  });
});

describe('fallback chain helpers', () => {
  it('parseFallbackChain maps api ids → ui entries; non-array → []', () => {
    expect(parseFallbackChain([{ providerId: 'p1', modelId: 'm1' }, { providerId: 'x', modelId: 'y' }], groups))
      .toEqual([{ provider: 'openai', model: 'gpt-4o' }]);
    expect(parseFallbackChain('nope', groups)).toEqual([]);
  });

  it('buildFallbackChainApi resolves ui entries → api ids, dropping blanks/unknowns', () => {
    expect(buildFallbackChainApi([{ provider: 'openai', model: 'gpt-4o' }, { provider: '', model: '' }], groups))
      .toEqual([{ providerId: 'p1', modelId: 'm1' }]);
  });
});
