import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter, server } from '@/test/test-utils';
import { CallbackPage } from '../../../src/auth/pages/CallbackPage';
import { __setStoredStateForTests } from '../../../src/auth/pkce/pkceFlow';
import { clearTokens, getAccessToken } from '../../../src/auth/tokens/tokenStore';

describe('CallbackPage', () => {
  beforeEach(() => {
    clearTokens();
    sessionStorage.removeItem('nexus_pkce_state');
  });

  it('renders a spinner during exchange then stores tokens on success', async () => {
    __setStoredStateForTests({ verifier: 'v', state: 'st', postAuthPath: '/dashboard' });
    server.use(
      http.post('/oauth/token', () =>
        HttpResponse.json({
          access_token: 'at-ok',
          refresh_token: 'rt-ok',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      ),
      http.get('/api/admin/me', () =>
        HttpResponse.json({
          keyId: 'u-cb',
          keyName: 'cb-user',
          roles: ['admins'],
          authPrincipalType: 'admin_user',
        }),
      ),
    );

    renderWithRouter(<CallbackPage />, { route: '/auth/callback?code=c&state=st' });

    // Completion message visible during pending state.
    expect(screen.getByRole('status')).toBeDefined();

    await waitFor(() => {
      expect(getAccessToken()).toBe('at-ok');
    });
  });

  it('renders an error panel with "Sign in again" when exchange fails', async () => {
    __setStoredStateForTests({ verifier: 'v', state: 'st', postAuthPath: '/' });
    server.use(
      http.post('/oauth/token', () =>
        HttpResponse.json({ error: 'invalid_grant' }, { status: 400 }),
      ),
    );

    renderWithRouter(<CallbackPage />, { route: '/auth/callback?code=c&state=st' });

    // Wait for the error UI to appear after the failed exchange.
    expect(
      await screen.findByRole('button', { name: /sign in again/i }),
    ).toBeDefined();
    // Error message echoes the provider error.
    expect(await screen.findByRole('alert')).toBeDefined();
  });

  it('renders an error when callback carries ?error=access_denied', async () => {
    __setStoredStateForTests({ verifier: 'v', state: 'st', postAuthPath: '/' });
    renderWithRouter(<CallbackPage />, {
      route: '/auth/callback?error=access_denied&error_description=user+canceled',
    });
    expect(
      await screen.findByRole('button', { name: /sign in again/i }),
    ).toBeDefined();
    expect((await screen.findByRole('alert')).textContent).toMatch(/access_denied/);
  });

  it('"Sign in again" restarts the OAuth flow (assign to /oauth/authorize)', async () => {
    __setStoredStateForTests({ verifier: 'v', state: 'st', postAuthPath: '/' });
    const origLoc = window.location;
    const assignCalls: string[] = [];
    delete (window as unknown as { location?: Location }).location;
    (window as unknown as { location: Partial<Location> }).location = {
      ...origLoc, origin: origLoc.origin, pathname: '/auth/callback',
      assign: ((u: string) => { assignCalls.push(u); }) as Location['assign'],
    };
    try {
      renderWithRouter(<CallbackPage />, { route: '/auth/callback?error=access_denied' });
      fireEvent.click(await screen.findByRole('button', { name: /sign in again/i }));
      await waitFor(() => expect(assignCalls.some((u) => new URL(u, origLoc.origin).pathname === '/oauth/authorize')).toBe(true));
    } finally {
      (window as unknown as { location: Location }).location = origLoc;
    }
  });
});
