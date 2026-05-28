import { describe, it, expect, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import i18n from '@/i18n';
import { LANGUAGE_STORAGE_KEY } from '../../../src/i18n';
import { ForgotPasswordPage } from '../../../src/auth/pages/ForgotPasswordPage';
import { renderWithRouter, server } from '@/test/test-utils';

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    server.use(http.get('/api/admin/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })));
  });

  it('renders guidance and back to sign in', async () => {
    renderWithRouter(
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Routes>,
      { route: '/forgot-password' },
    );

    expect(await screen.findByRole('heading', { name: /forgot password/i })).toBeDefined();
    expect(screen.getByText(/does not offer self-service password reset/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /back to sign in/i })).toBeDefined();
  });

  it('Back to sign in navigates to /login', async () => {
    renderWithRouter(
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/login" element={<div>login-landing</div>} />
      </Routes>,
      { route: '/forgot-password' },
    );
    fireEvent.click(await screen.findByRole('button', { name: /back to sign in/i }));
    expect(await screen.findByText('login-landing')).toBeInTheDocument();
  });

  it('the language switcher persists the chosen language', async () => {
    renderWithRouter(
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Routes>,
      { route: '/forgot-password' },
    );
    const select = await screen.findByLabelText(i18n.t('language'));
    fireEvent.change(select, { target: { value: 'zh' } });
    await waitFor(() => expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('zh'));
    await i18n.changeLanguage('en'); // restore for sibling tests
  });
});
