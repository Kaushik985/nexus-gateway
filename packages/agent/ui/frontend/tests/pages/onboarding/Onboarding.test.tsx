import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { Onboarding } from '@/pages/onboarding/Onboarding';
import type { StatusSnapshot } from '@/api/agent';

const api = vi.hoisted(() => ({ agentApi: {
  authenticateSSO: vi.fn().mockResolvedValue({ success: true }),
  authenticateConfirm: vi.fn().mockResolvedValue({ success: true }),
  authenticateCancel: vi.fn().mockResolvedValue({ acknowledged: true }),
  enrollWithToken: vi.fn().mockResolvedValue({ success: true, device_id: 'd1' }),
} }));
vi.mock('@/api/agent', () => api);

const statusFor = (deviceAuthMode: string) => ({ agent: { deviceAuthMode } } as unknown as StatusSnapshot);
const wrap = (ui: React.ReactElement) => render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

describe('Onboarding', () => {
  it('enterprise-login mode renders the SSO branch + starts SSO', async () => {
    wrap(<Onboarding status={statusFor('enterprise-login')} onEnrollmentAttempted={vi.fn()} />);
    const btns = screen.getAllByRole('button');
    fireEvent.click(btns[btns.length - 1]); // the SSO start button
    await waitFor(() => expect(api.agentApi.authenticateSSO).toHaveBeenCalled());
  });

  it('mtls-only mode enrolls with the entered token', async () => {
    wrap(<Onboarding status={statusFor('mtls-only')} onEnrollmentAttempted={vi.fn()} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'enroll-tok' } });
    const btns = screen.getAllByRole('button');
    fireEvent.click(btns[btns.length - 1]);
    await waitFor(() => expect(api.agentApi.enrollWithToken).toHaveBeenCalledWith('enroll-tok'));
  });

  it('renders the discovering branch when no mode is reported', () => {
    const { container } = wrap(<Onboarding status={statusFor('')} onEnrollmentAttempted={vi.fn()} />);
    expect((container.textContent || '').length).toBeGreaterThan(0);
  });
});
