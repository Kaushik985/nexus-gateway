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

describe('SecretDialog requireAcknowledgement extension', () => {
  afterEach(() => vi.restoreAllMocks());

  function findSecondaryClose() {
    const buttons = screen.getAllByRole('button', { name: 'Close' });
    return buttons.find((b) => b.className.includes('secondary'))!;
  }

  it('disables the secondary Close button until the acknowledgement checkbox is ticked', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <SecretDialog
        open
        secret="nx_cs_gated"
        title="Save secret"
        warning="Save it now"
        requireAcknowledgement
        acknowledgementLabel="I have stored this secret securely."
        onClose={onClose}
      />,
    );
    const close = findSecondaryClose();
    expect(close).toBeDisabled();

    const ack = screen.getByRole('checkbox', { name: /I have stored this secret securely/i });
    fireEvent.click(ack);

    expect(close).toBeEnabled();
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Radix overlay/Escape close attempts while the ack gate is still active', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <SecretDialog
        open
        secret="nx_cs_gated"
        title="t"
        warning="w"
        requireAcknowledgement
        acknowledgementLabel="ack"
        onClose={onClose}
      />,
    );
    // Pressing the disabled Close does nothing.
    fireEvent.click(findSecondaryClose());
    expect(onClose).not.toHaveBeenCalled();

    // Escape (which Radix forwards as onOpenChange(false)) is also a no-op
    // because SecretDialog gates onOpenChange behind closeDisabled.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the default Close path enabled when requireAcknowledgement is omitted', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <SecretDialog
        open
        secret="nx_cs_default"
        title="t"
        warning="w"
        onClose={onClose}
      />,
    );
    expect(findSecondaryClose()).toBeEnabled();
  });
});
