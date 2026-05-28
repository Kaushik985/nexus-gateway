import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { Settings } from '@/pages/settings/Settings';
import type { StatusSnapshot } from '@/api/agent';

vi.mock('@/api/agent', () => ({ agentApi: { checkUpdate: vi.fn().mockResolvedValue({ available: false }), pauseProtection: vi.fn(), resumeProtection: vi.fn(), unenroll: vi.fn() } }));
vi.mock('@/theme/ThemeProvider', () => ({ useTheme: () => ({ mode: 'system', setMode: vi.fn() }) }));

const status = { state: 'active', paused: false, pausedUntil: null, agent: { version: '1.2.3', deviceID: 'd1' } } as unknown as StatusSnapshot;

describe('agent Settings', () => {
  it('renders settings controls from the status', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}><I18nextProvider i18n={i18n}><MemoryRouter><Settings status={status} /></MemoryRouter></I18nextProvider></QueryClientProvider>,
    );
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });
});
