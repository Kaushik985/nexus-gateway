import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { RequireRole } from '../../../src/auth/guards/RequireRole';

const mockStatus = vi.fn().mockReturnValue('authenticated');
const mockPermissions = vi.fn().mockReturnValue([]);
vi.mock('../../../src/auth/context/AuthContext', () => ({
  useAuth: () => ({
    status: mockStatus(),
    permissions: mockPermissions(),
    roles: [],
    login: vi.fn(),
    logout: vi.fn(),
    completeLogin: vi.fn(),
    refreshSession: vi.fn(),
  }),
}));

function renderInRouter(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </MemoryRouter>,
  );
}

describe('RequireRole', () => {
  it('renders children when the required IAM action is in permissions', () => {
    mockStatus.mockReturnValue('authenticated');
    mockPermissions.mockReturnValue(['admin:provider.create']);
    renderInRouter(
      <RequireRole allowedActions={['admin:provider.create']}>
        <div>protected-content</div>
      </RequireRole>,
    );
    expect(screen.getByText('protected-content')).toBeDefined();
  });

  it('shows access denied when authenticated but required action is not in permissions', () => {
    mockStatus.mockReturnValue('authenticated');
    mockPermissions.mockReturnValue(['admin:provider.read']);
    renderInRouter(
      <RequireRole allowedActions={['admin:provider.create']}>
        <div>protected-content</div>
      </RequireRole>,
    );
    expect(screen.queryByText('protected-content')).toBeNull();
    expect(screen.getByRole('heading')).toBeDefined();
  });

  it('shows loading state while session is resolving', () => {
    mockStatus.mockReturnValue('loading');
    mockPermissions.mockReturnValue([]);
    const { container } = renderInRouter(
      <RequireRole allowedActions={['admin:provider.create']}>
        <div>protected-content</div>
      </RequireRole>,
    );
    expect(screen.queryByText('protected-content')).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeDefined();
  });

  it('shows access denied when permissions is empty', () => {
    mockStatus.mockReturnValue('authenticated');
    mockPermissions.mockReturnValue([]);
    renderInRouter(
      <RequireRole allowedActions={['admin:provider.create']}>
        <div>protected-content</div>
      </RequireRole>,
    );
    expect(screen.queryByText('protected-content')).toBeNull();
  });

  it('redirects to /login when unauthenticated (no access-denied panel)', () => {
    mockStatus.mockReturnValue('unauthenticated');
    mockPermissions.mockReturnValue([]);
    // Render inside real Routes so the guard's <Navigate to="/login"> resolves
    // to a concrete element (a bare router leaves the redirect dangling).
    render(
      <MemoryRouter initialEntries={['/secret']}>
        <I18nextProvider i18n={i18n}>
          <Routes>
            <Route
              path="/secret"
              element={
                <RequireRole allowedActions={['admin:provider.create']}>
                  <div>protected-content</div>
                </RequireRole>
              }
            />
            <Route path="/login" element={<div>login-page</div>} />
          </Routes>
        </I18nextProvider>
      </MemoryRouter>,
    );
    // Unauthenticated must take the redirect path, not the access-denied panel
    // (which is the authenticated-but-forbidden case).
    expect(screen.queryByText('protected-content')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByText('login-page')).toBeInTheDocument();
  });
});
