import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { AgentNotRunning } from '@/pages/diagnostics/AgentNotRunning';
const wrap = (ui: React.ReactElement) => render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
describe('AgentNotRunning', () => {
  afterEach(() => vi.restoreAllMocks());
  it('renders + fires onRetry', () => {
    const onRetry = vi.fn();
    wrap(<AgentNotRunning onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('agentNotRunning.retry') }));
    expect(onRetry).toHaveBeenCalled();
  });
  it('copies the troubleshoot command', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    wrap(<AgentNotRunning onRetry={vi.fn()} />);
    const copyBtn = screen.getAllByRole('button').find((b) => b !== screen.getByRole('button', { name: i18n.t('agentNotRunning.retry') }));
    fireEvent.click(copyBtn!);
    expect(writeText).toHaveBeenCalled();
  });
});
