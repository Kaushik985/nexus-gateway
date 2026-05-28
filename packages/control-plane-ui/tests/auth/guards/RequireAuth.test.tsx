import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RequireAuth } from '../../../src/auth/guards/RequireAuth';

const mockStatus = vi.fn().mockReturnValue('authenticated');
vi.mock('../../../src/auth/context/AuthContext', () => ({
  useAuth: () => ({ status: mockStatus() }),
}));

function renderGuarded() {
  return render(
    <MemoryRouter initialEntries={['/secret']}>
      <Routes>
        <Route
          path="/secret"
          element={
            <RequireAuth>
              <div>protected-content</div>
            </RequireAuth>
          }
        />
        <Route path="/login" element={<div>login-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireAuth', () => {
  it('renders the protected children once authenticated', () => {
    mockStatus.mockReturnValue('authenticated');
    renderGuarded();
    expect(screen.getByText('protected-content')).toBeInTheDocument();
  });

  it('shows the session-loading state while auth is resolving', () => {
    mockStatus.mockReturnValue('loading');
    const { container } = renderGuarded();
    expect(screen.queryByText('protected-content')).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('redirects to /login when unauthenticated', () => {
    mockStatus.mockReturnValue('unauthenticated');
    renderGuarded();
    expect(screen.queryByText('protected-content')).toBeNull();
    expect(screen.getByText('login-page')).toBeInTheDocument();
  });
});
