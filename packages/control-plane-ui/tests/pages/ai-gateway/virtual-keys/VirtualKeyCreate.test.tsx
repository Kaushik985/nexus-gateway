import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { VirtualKeyCreate } from '@/pages/ai-gateway/virtual-keys/VirtualKeyCreate';

const svc = vi.hoisted(() => ({
  virtualKeyApi: { create: vi.fn() },
  projectApi: { list: vi.fn() },
  systemApi: { listModels: vi.fn() },
}));
vi.mock('@/api/services', () => svc);
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => vi.fn() }));
vi.mock('@/hooks/useMutation', () => ({
  useMutation: (fn: (a: unknown) => Promise<unknown>, opts?: { onSuccess?: (r: unknown) => void }) => ({
    mutate: async (arg: unknown) => { const r = await fn(arg); opts?.onSuccess?.(r); return r; },
    loading: false,
  }),
}));
const apiByKey = vi.hoisted(() => ({ models: undefined as unknown, projects: undefined as unknown }));
vi.mock('@/hooks/useApi', () => ({
  useApi: (_fn: unknown, key: unknown[]) => (key.includes('projects') ? apiByKey.projects : apiByKey.models),
}));

function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() {
  return render(<I18nextProvider i18n={i18n}><MemoryRouter><VirtualKeyCreate /></MemoryRouter></I18nextProvider>);
}
const createLabel = () => i18n.t('pages:virtualKeys.createVirtualKey');

describe('VirtualKeyCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiByKey.models = ok({ data: [] });
    apiByKey.projects = ok({ data: [{ id: 'p1', name: 'Proj' }] });
    svc.virtualKeyApi.create.mockResolvedValue({ key: 'nx_secret_plain', id: 'vk1' });
  });

  it('renders the create form with the name field', () => {
    wrap();
    expect(screen.getByPlaceholderText(i18n.t('pages:virtualKeys.namePlaceholder'))).toBeInTheDocument();
  });

  it('does not submit when the name is empty (zod required)', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: createLabel() }));
    await new Promise((r) => setTimeout(r, 50));
    expect(svc.virtualKeyApi.create).not.toHaveBeenCalled();
  });

  it('submits an application VK then reveals the secret key', async () => {
    const user = userEvent.setup();
    wrap();
    const nameInput = screen.getByPlaceholderText(i18n.t('pages:virtualKeys.namePlaceholder'));
    await user.type(nameInput, 'prod-key');
    // handleSubmit validates independently of the isValid-gated button's
    // disabled state, so submit the form directly.
    fireEvent.submit(nameInput.closest('form')!);
    await waitFor(() => expect(svc.virtualKeyApi.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'prod-key', vkType: 'application', enabled: true })));
    await waitFor(() => expect(screen.getByText('nx_secret_plain')).toBeInTheDocument());
  });
});
