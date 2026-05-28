import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, act, render } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter, server } from '@/test/test-utils';
import { useAuth } from '../../../src/auth/context/AuthContext';
import { clearTokens, getAccessToken, setTokens } from '../../../src/auth/tokens/tokenStore';

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <div data-testid="status">{auth.status}</div>
      <div data-testid="keyName">{auth.keyName ?? ''}</div>
      <div data-testid="roles">{auth.roles.join(',')}</div>
      <div data-testid="principalType">{auth.principalType ?? ''}</div>
      <div data-testid="email">{auth.email ?? ''}</div>
      <button onClick={() => auth.logout()}>logout</button>
      <button
        onClick={() => {
          void auth.completeLogin({ accessToken: 'at-cb', refreshToken: 'rt-cb' });
        }}
      >
        complete-login
      </button>
      <button
        onClick={() => {
          void auth.completeLogin({ accessToken: 'at-bad', refreshToken: 'rt-bad' });
        }}
      >
        complete-login-bad
      </button>
      <button onClick={() => void auth.refreshSession()}>refresh</button>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    clearTokens();
  });

  it('boots to unauthenticated when no access token is present', async () => {
    // Global setup seeds a token; clear it to simulate a cold start.
    // Default MSW handler returns a 200 /me, but we should never hit it.
    const { unmount } = renderWithRouter(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('unauthenticated');
    });
    unmount();
  });

  it('boots to authenticated when access token + /me respond 200', async () => {
    setTokens({ accessToken: 'at', refreshToken: 'rt' });
    server.use(
      http.get('/api/admin/me', () =>
        HttpResponse.json({
          keyId: 'u-1',
          keyName: 'alice',
          roles: ['admins'],
          authPrincipalType: 'admin_user',
          email: 'alice@nexus.ai',
        }),
      ),
    );
    renderWithRouter(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authenticated');
    });
    expect(screen.getByTestId('keyName').textContent).toBe('alice');
    expect(screen.getByTestId('roles').textContent).toBe('admins');
    expect(screen.getByTestId('principalType').textContent).toBe('admin_user');
  });

  it('boots to unauthenticated when /me returns 401 after refresh failure', async () => {
    setTokens({ accessToken: 'at', refreshToken: 'rt' });
    server.use(
      http.get('/api/admin/me', () =>
        HttpResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 }),
      ),
      http.post('/oauth/token', () =>
        HttpResponse.json({ error: 'invalid_grant' }, { status: 400 }),
      ),
    );

    // Stub window.location to swallow the /login redirect triggered by
    // api/client on refresh failure.
    const origLoc = window.location;
    delete (window as unknown as { location?: Location }).location;
    (window as unknown as { location: Partial<Location> }).location = {
      ...origLoc,
      pathname: '/dashboard',
      assign: () => {},
    };

    try {
      renderWithRouter(<Probe />);
      await waitFor(() => {
        expect(screen.getByTestId('status').textContent).toBe('unauthenticated');
      });
      expect(getAccessToken()).toBeUndefined();
    } finally {
      (window as unknown as { location: Location }).location = origLoc;
    }
  });

  it('completeLogin stores tokens and fetches /me', async () => {
    // No tokens on mount → unauthenticated. Then clicking complete-login
    // stores a new pair and fetches /me.
    let meCalls = 0;
    server.use(
      http.get('/api/admin/me', ({ request }) => {
        meCalls += 1;
        const auth = request.headers.get('authorization');
        if (auth !== 'Bearer at-cb') {
          return HttpResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
        }
        return HttpResponse.json({
          keyId: 'u-2',
          keyName: 'bob',
          roles: ['viewers'],
          authPrincipalType: 'admin_user',
        });
      }),
    );

    renderWithRouter(<Probe />);
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('unauthenticated'),
    );

    await act(async () => {
      screen.getByText('complete-login').click();
      // Small tick so the async chain inside completeLogin can progress.
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('authenticated'),
    );
    expect(screen.getByTestId('keyName').textContent).toBe('bob');
    expect(getAccessToken()).toBe('at-cb');
    expect(meCalls).toBeGreaterThanOrEqual(1);
  });

  it('logout clears tokens, flips to unauthenticated, and redirects to /login', async () => {
    setTokens({ accessToken: 'at', refreshToken: 'rt' });
    server.use(
      http.get('/api/admin/me', () =>
        HttpResponse.json({ keyId: 'u', keyName: 'al', roles: [], authPrincipalType: 'admin_user' }),
      ),
    );
    const origLoc = window.location;
    delete (window as unknown as { location?: Location }).location;
    const assign = vi.fn();
    (window as unknown as { location: Partial<Location> }).location = {
      ...origLoc,
      origin: origLoc.origin,
      pathname: '/dashboard',
      assign,
    };
    try {
      renderWithRouter(<Probe />);
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
      await act(async () => {
        screen.getByText('logout').click();
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(screen.getByTestId('status').textContent).toBe('unauthenticated');
      expect(getAccessToken()).toBeUndefined();
      expect(assign).toHaveBeenCalledWith('/login');
    } finally {
      (window as unknown as { location: Location }).location = origLoc;
    }
  });

  it('completeLogin drops tokens and stays unauthenticated when /me rejects', async () => {
    server.use(
      http.get('/api/admin/me', () =>
        HttpResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 }),
      ),
      http.post('/oauth/token', () => HttpResponse.json({ error: 'x' }, { status: 400 })),
    );
    const origLoc = window.location;
    delete (window as unknown as { location?: Location }).location;
    (window as unknown as { location: Partial<Location> }).location = {
      ...origLoc,
      origin: origLoc.origin,
      pathname: '/dashboard',
      assign: () => {},
    };
    try {
      renderWithRouter(<Probe />);
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
      await act(async () => {
        screen.getByText('complete-login-bad').click();
        await new Promise((r) => setTimeout(r, 0));
      });
      // /me 401 right after token-set → tokens wiped, still unauthenticated.
      await waitFor(() => expect(getAccessToken()).toBeUndefined());
      expect(screen.getByTestId('status').textContent).toBe('unauthenticated');
    } finally {
      (window as unknown as { location: Location }).location = origLoc;
    }
  });

  it('refreshSession re-pulls /me and updates identity', async () => {
    setTokens({ accessToken: 'at', refreshToken: 'rt' });
    let name = 'before';
    server.use(
      http.get('/api/admin/me', () =>
        HttpResponse.json({ keyId: 'u', keyName: name, roles: [], authPrincipalType: 'admin_user' }),
      ),
    );
    renderWithRouter(<Probe />);
    await waitFor(() => expect(screen.getByTestId('keyName').textContent).toBe('before'));
    name = 'after-edit';
    await act(async () => {
      screen.getByText('refresh').click();
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitFor(() => expect(screen.getByTestId('keyName').textContent).toBe('after-edit'));
  });

  it('boots to unauthenticated (not a crash) when /me returns a non-401 error', async () => {
    // A 5xx is NOT the refresh-retry path; fetchMe must swallow it and let the
    // app render unauthenticated rather than throw and white-screen.
    setTokens({ accessToken: 'at', refreshToken: 'rt' });
    server.use(
      http.get('/api/admin/me', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
      http.get('/api/admin/me/permissions', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    );
    renderWithRouter(<Probe />);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
  });

  it('useAuth throws when used outside an AuthProvider', () => {
    function Bare() {
      useAuth();
      return null;
    }
    // Plain render with NO AuthProvider (renderWithProviders always wraps one).
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Bare />)).toThrow('useAuth must be used within AuthProvider');
    spy.mockRestore();
  });
});
