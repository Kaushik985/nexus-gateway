import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ReliabilityPanel } from '@/pages/ai-gateway/credentials/ReliabilityPanel';

const svc = vi.hoisted(() => ({ credentialApi: { get: vi.fn(), updateReliabilityOverrides: vi.fn(), probe: vi.fn(), circuitReset: vi.fn() } }));
vi.mock('@/api/services', () => svc);
vi.mock('@/hooks/useApi', () => ({ useApi: () => ({ data: undefined, loading: false, error: null, refetch: vi.fn() }) }));
vi.mock('@/hooks/useMutation', () => ({
  useMutation: (fn: (a: unknown) => Promise<unknown>, opts?: { onSuccess?: (r: unknown) => void }) => ({
    mutate: async (arg: unknown) => { const r = await fn(arg); opts?.onSuccess?.(r); return r; },
    loading: false,
  }),
}));

const seed = {
  id: 'c1', name: 'cred', providerId: 'p1', reliabilityOverrides: null,
  circuitState: 'open', healthSuccessRate5m: 0.95, healthSuccessRate1h: 0.9, healthSamplesObserved: 100,
} as never;
function wrap(canEdit = true) {
  return render(<I18nextProvider i18n={i18n}><ReliabilityPanel credentialId="c1" canEdit={canEdit} seed={seed} /></I18nextProvider>);
}

describe('ReliabilityPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.credentialApi.probe.mockResolvedValue({ ok: true, statusCode: 200, elapsedMs: 50 });
    svc.credentialApi.circuitReset.mockResolvedValue({});
    svc.credentialApi.updateReliabilityOverrides.mockResolvedValue({});
  });

  it('renders the reliability summary + edit affordances when editable', () => {
    wrap(true);
    expect(screen.getByText(i18n.t('pages:credentials.reliabilityCurrent'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18n.t('pages:credentials.testCredential') })).toBeInTheDocument();
  });

  it('hides the action buttons when not editable', () => {
    wrap(false);
    expect(screen.queryByRole('button', { name: i18n.t('pages:credentials.testCredential') })).not.toBeInTheDocument();
  });

  it('Test credential runs the probe and renders the result', async () => {
    wrap(true);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:credentials.testCredential') }));
    await waitFor(() => expect(svc.credentialApi.probe).toHaveBeenCalledWith('c1'));
  });

  it('Circuit reset is offered for an open circuit and calls circuitReset', async () => {
    wrap(true);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:credentials.circuitReset') }));
    await waitFor(() => expect(svc.credentialApi.circuitReset).toHaveBeenCalledWith('c1'));
  });

  it('editing then saving with empty thresholds persists null overrides', async () => {
    wrap(true);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:edit') }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:save') }));
    await waitFor(() => expect(svc.credentialApi.updateReliabilityOverrides).toHaveBeenCalledWith('c1', null));
  });
});
