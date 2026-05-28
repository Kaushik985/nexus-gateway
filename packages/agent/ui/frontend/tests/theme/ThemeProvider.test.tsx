import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

vi.mock('@/api/agent', () => ({ agentApi: { getAppliedConfig: vi.fn().mockResolvedValue({}) } }));

function Probe() {
  const { mode, setMode, themeId, setThemeId, brand } = useTheme();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="themeId">{themeId}</span>
      <span data-testid="brand">{brand.productName}</span>
      <button onClick={() => setMode('dark')}>dark</button>
      <button onClick={() => setThemeId('morningstar')}>ms</button>
    </div>
  );
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ThemeProvider><Probe /></ThemeProvider></QueryClientProvider>);
}

describe('agent ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    if (!window.matchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (q: string) => ({ matches: false, media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
      });
    }
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline')); // loadTheme falls back to DEFAULT
  });
  afterEach(() => vi.restoreAllMocks());

  it('provides the default mode + brand and resolves system preference', async () => {
    wrap();
    expect(screen.getByTestId('mode').textContent).toBe('system');
    expect(screen.getByTestId('brand').textContent!.length).toBeGreaterThan(0);
    // data-theme applied to <html>
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toMatch(/light|dark/));
  });

  it('setMode persists to localStorage + applies the data-theme', async () => {
    wrap();
    await act(async () => { screen.getByText('dark').click(); });
    expect(localStorage.getItem('nexus-dashboard-theme-mode')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('setThemeId persists the operator theme pick', async () => {
    wrap();
    await act(async () => { screen.getByText('ms').click(); });
    expect(localStorage.getItem('nexus-dashboard-theme-id')).toBe('morningstar');
  });
});
