/**
 * HookPipelinePanel — driven with a mocked useApi execution-chain fixture so the
 * timeline (milestones + hook segments), the StepCards, reordering and the
 * empty/loading/error branches are asserted. Replaces the render-without-crash
 * smoke test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { HookPipelinePanel } from '@/pages/compliance/hooks/panels/HookPipelinePanel';

const apiState = vi.hoisted(() => ({ value: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() } }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiState.value }));
vi.mock('@/hooks/useMutation', () => ({
  useMutation: (fn: (a: unknown) => Promise<unknown>, opts?: { onSuccess?: () => void }) => ({
    mutate: async (a: unknown) => { await fn(a); opts?.onSuccess?.(); },
    loading: false,
  }),
}));
const reorder = vi.hoisted(() => vi.fn());
vi.mock('@/api/services', () => ({ hookApi: { getExecutionChain: vi.fn(), reorder: (a: unknown) => reorder(a) } }));

const step = (id: string, name: string, order: number) => ({
  hookConfigId: id, name, order, enabled: true, wired: true, priority: 10, executionMode: 'sync',
  classification: { category: 'compliance', categoryLabel: 'Compliance', phaseLabel: 'Request', implementationLabel: '', dualPhaseCapable: false },
});
const CHAIN = {
  totalHooks: 2, enabledHooks: 2,
  flow: [
    { kind: 'milestone', id: 'ingress', label: 'Ingress' },
    { kind: 'hook_segment', id: 'request', label: 'Request', phase: 'request', steps: [step('h1', 'PII Scanner', 1), step('h2', 'Secret Filter', 2)] },
  ],
};

function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><HookPipelinePanel /></I18nextProvider>); }

describe('HookPipelinePanel', () => {
  beforeEach(() => { vi.clearAllMocks(); reorder.mockResolvedValue({}); apiState.value = ok(CHAIN); });

  it('renders the pipeline summary + both hook steps', () => {
    wrap();
    expect(screen.getByText(i18n.t('pages:hooks.pipelineSummary', { total: 2, enabled: 2 }))).toBeInTheDocument();
    expect(screen.getByText('PII Scanner')).toBeInTheDocument();
    expect(screen.getByText('Secret Filter')).toBeInTheDocument();
  });

  it('reordering a step moves its id and calls hookApi.reorder', async () => {
    wrap();
    // first step's "down" arrow swaps h1/h2 → ids [h2, h1]
    fireEvent.click(screen.getAllByRole('button', { name: i18n.t('pages:hooks.reorderDown') })[0]);
    await waitFor(() => expect(reorder).toHaveBeenCalledWith({ stage: 'request', ids: ['h2', 'h1'] }));
  });

  it('shows the empty-phase placeholder for a segment with no hooks', () => {
    apiState.value = ok({ totalHooks: 0, enabledHooks: 0, flow: [{ kind: 'hook_segment', id: 'response', label: 'Response', phase: 'response', steps: [] }] });
    wrap();
    expect(screen.getByText(i18n.t('pages:hooks.pipelineEmptyPhase'))).toBeInTheDocument();
  });

  it('renders the loading and error branches', () => {
    apiState.value = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { unmount } = wrap();
    expect(screen.queryByText('PII Scanner')).toBeNull();
    unmount();
    apiState.value = { data: undefined, loading: false, error: new Error('chain boom'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('chain boom')).toBeInTheDocument();
  });
});
