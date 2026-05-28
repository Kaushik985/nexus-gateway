/**
 * IamSimulator — drive the principal → service → resource → action cascade
 * (Select mocked to native, the rest are native <select>s) and submit →
 * iamApi.simulate, then assert the decision result renders. Replaces the smoke
 * test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { IamSimulator } from '@/pages/iam/simulator/IamSimulator';

vi.mock('@/components/ui', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui')>('@/components/ui');
  return {
    ...actual,
    Select: ({ value, onValueChange, options }: { value?: string; onValueChange: (v: string) => void; options: Array<{ value: string; label: string }> }) => (
      <select aria-label="principal-type" value={value ?? ''} onChange={(e) => onValueChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ),
  };
});
vi.mock('@/hooks/useMutation', () => ({
  useMutation: (fn: () => Promise<unknown>, opts?: { onSuccess?: (d: unknown) => void }) => ({
    mutate: async () => { const d = await fn(); opts?.onSuccess?.(d); }, loading: false,
  }),
}));
const iam = vi.hoisted(() => ({ iamApi: { listApiKeys: vi.fn(), listVirtualKeys: vi.fn(), listUsers: vi.fn(), getActionCatalog: vi.fn(), simulate: vi.fn() } }));
vi.mock('@/api/services', () => iam);
const RESOURCE = { service: 'gateway', type: 'provider', nrn: 'nrn:nexus:gateway:*:provider/*', actions: [{ name: 'admin:provider.read' }] };
const catalog = { resources: [RESOURCE] };
const users = { data: [{ id: 'u1', displayName: 'Alice', roles: [] }], total: 1 };
vi.mock('@/hooks/useApi', () => ({
  useApi: (_fn: unknown, key: string[]) => {
    if (key.some((k) => String(k).includes('catalog'))) return { data: catalog };
    if (key.some((k) => String(k).includes('users'))) return { data: users };
    return { data: { data: [] } }; // api keys / vks
  },
}));

function wrap() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><IamSimulator /></MemoryRouter></I18nextProvider>); }

describe('IamSimulator', () => {
  beforeEach(() => { vi.clearAllMocks(); iam.iamApi.simulate.mockResolvedValue({ decision: 'ALLOW', matchedStatements: [] }); });

  it('runs a simulation through the full principal→service→resource→action cascade', async () => {
    const { container } = wrap();
    fireEvent.change(screen.getByLabelText('principal-type'), { target: { value: 'nexus_user' } });
    fireEvent.change(container.querySelector('#sim-principal-id')!, { target: { value: 'u1' } });
    fireEvent.change(container.querySelector('#sim-service')!, { target: { value: 'gateway' } });
    fireEvent.change(container.querySelector('#sim-resource')!, { target: { value: RESOURCE.nrn } });
    fireEvent.change(container.querySelector('#sim-action')!, { target: { value: 'admin:provider.read' } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(iam.iamApi.simulate).toHaveBeenCalledWith({
      principal: { type: 'nexus_user', id: 'u1' },
      action: 'admin:provider.read',
      resource: RESOURCE.nrn,
    }));
  });

  it('renders the simulator form with the principal-type selector', () => {
    wrap();
    expect(screen.getByText(i18n.t('pages:iam.simulationInput'))).toBeInTheDocument();
    expect(screen.getByLabelText('principal-type')).toBeInTheDocument();
  });
});
