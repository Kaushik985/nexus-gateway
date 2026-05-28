import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/test-utils';
import { SecretDialog } from '../../../../src/components/ui/SecretDialog/SecretDialog';

describe('SecretDialog', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the secret + warning when open', () => {
    renderWithProviders(
      <SecretDialog open secret="sk-abc123" title="New key" warning="Copy it now" onClose={() => {}} />,
    );
    expect(screen.getByText('sk-abc123')).toBeInTheDocument();
    expect(screen.getByText('Copy it now')).toBeInTheDocument();
  });

  it('copies the secret to the clipboard on copy click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // Define AFTER any userEvent setup would stub it; use fireEvent so the
    // component reads our navigator.clipboard mock directly.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderWithProviders(
      <SecretDialog open secret="sk-xyz" title="t" warning="w" onClose={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('sk-xyz');
  });

  it('fires onClose from the secondary Close button', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <SecretDialog open secret="s" title="t" warning="w" onClose={onClose} />,
    );
    // Two elements are named "Close": the Dialog's X (aria-label) and this
    // component's secondary Button (text). Target the secondary one.
    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    const secondary = closeButtons.find((b) => b.className.includes('secondary'))!;
    await user.click(secondary);
    expect(onClose).toHaveBeenCalled();
  });
});
