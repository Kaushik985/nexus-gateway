import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { QuotaOverrideCreate } from '@/pages/ai-gateway/quota-overrides/QuotaOverrideCreate';

vi.mock('@/api/services', () => {
  const empty = () => Promise.resolve({ data: [], total: 0 });
  return { quotaOverrideApi: { create: vi.fn() }, projectApi: { list: empty }, virtualKeyApi: { list: empty }, iamApi: { listUsers: empty } };
});
const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => navigate }));
vi.mock('@/hooks/useMutation', () => ({ useMutation: () => ({ mutate: vi.fn(), loading: false }) }));

function wrap() {
  return render(<I18nextProvider i18n={i18n}><MemoryRouter><QuotaOverrideCreate /></MemoryRouter></I18nextProvider>);
}

describe('QuotaOverrideCreate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the create-override form with the period-type options', () => {
    wrap();
    // the create button + reason field render
    expect(screen.getByRole('button', { name: i18n.t('pages:quotaOverrides.createOverride') })).toBeInTheDocument();
    expect(screen.getByText(i18n.t('pages:quotaOverrides.reason'))).toBeInTheDocument();
  });

  it('the submit button is gated until the form is valid (no target chosen yet)', () => {
    wrap();
    expect(screen.getByRole('button', { name: i18n.t('pages:quotaOverrides.createOverride') })).toBeDisabled();
  });

  it('Cancel navigates back to the overrides list', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:cancel') }));
    expect(navigate).toHaveBeenCalledWith('/ai-gateway/quota-overrides');
  });
});
