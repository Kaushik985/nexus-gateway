import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRoutingRuleForm } from '@/pages/ai-gateway/routing/form/useRoutingRuleForm';

const mutateCalls: unknown[] = [];
const addToast = vi.fn();
const onClose = vi.fn();
const onSaved = vi.fn();
const groups = [
  { provider: { id: 'p1', name: 'openai', enabled: true }, models: [{ id: 'm1', providerModelId: 'gpt-4o', enabled: true }] },
];

vi.mock('react-i18next', async (o) => ({ ...(await o<typeof import('react-i18next')>()), useTranslation: () => ({ t: (k: string) => k }) as never }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => ({ data: { data: groups } }) }));
vi.mock('@/hooks/useMutation', () => ({ useMutation: () => ({ mutate: (a: unknown) => mutateCalls.push(a), loading: false }) }));
vi.mock('@/api/services', () => ({ routingApi: {}, systemApi: {} }));

const rule = {
  id: 'r1', name: 'My Rule', description: 'desc', strategyType: 'single',
  priority: 7, pipelineStage: 1, enabled: false, config: { type: 'single' }, matchConditions: {},
} as never;

function mount() {
  return renderHook(() => useRoutingRuleForm({ rule, onClose, onSaved }));
}

describe('useRoutingRuleForm', () => {
  beforeEach(() => { mutateCalls.length = 0; addToast.mockClear(); });

  it('initializes form state from the rule prop', () => {
    const { result } = mount();
    expect(result.current.name).toBe('My Rule');
    expect(result.current.description).toBe('desc');
    expect(result.current.priority).toBe('7');
    expect(result.current.enabled).toBe(false);
    expect(result.current.strategyType).toBe('single');
  });

  it('entry + fallback helpers mutate their row arrays', () => {
    const { result } = mount();
    act(() => result.current.addEntry());
    act(() => result.current.updateEntry(result.current.entries.length - 1, 'provider', 'openai'));
    expect(result.current.entries.at(-1)!.provider).toBe('openai');
    act(() => result.current.addFallback());
    act(() => result.current.updateFallback(0, 'model', 'gpt-4o'));
    expect(result.current.fallbackEntries[0].model).toBe('gpt-4o');
    act(() => result.current.removeFallback(0));
    expect(result.current.fallbackEntries).toHaveLength(0);
  });

  it('handleStrategyChange switches strategy + hydrates conditional', () => {
    const { result } = mount();
    act(() => result.current.handleStrategyChange('loadbalance'));
    expect(result.current.strategyType).toBe('loadbalance');
    expect(result.current.showWeightColumn).toBe(true);
    act(() => result.current.handleStrategyChange('conditional'));
    expect(result.current.conditionalUi.mode).toBeDefined();
  });

  it('handleSubmit (single) toasts when no model is chosen, submits when valid', () => {
    const { result } = mount();
    act(() => result.current.handleSubmit());
    expect(addToast).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(mutateCalls).toHaveLength(0);

    act(() => { result.current.setSingleProvider('openai'); result.current.setSingleModel('gpt-4o'); });
    act(() => result.current.handleSubmit());
    expect(mutateCalls).toHaveLength(1);
    expect(mutateCalls[0]).toMatchObject({ name: 'My Rule', strategyType: 'single', pipelineStage: 1 });
  });
});
