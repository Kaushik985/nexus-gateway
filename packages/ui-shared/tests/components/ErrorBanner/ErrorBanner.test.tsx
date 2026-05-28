import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBanner } from '../../../src/components/ErrorBanner/ErrorBanner';

// Pure presentational error banner shared by CP-UI + Agent-UI. Action labels
// are caller-supplied (each app owns its i18n), so the component must render
// only what it's given and fire the supplied callbacks.
describe('ErrorBanner', () => {
  it('renders the message with role=alert', () => {
    render(<ErrorBanner message="Something failed" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something failed')).toBeInTheDocument();
  });

  it('renders the optional detail line when provided', () => {
    render(<ErrorBanner message="Denied" detail="ExplicitDeny on provider/x" />);
    expect(screen.getByText('ExplicitDeny on provider/x')).toBeInTheDocument();
  });

  it('omits the retry + dismiss buttons when no handlers are given', () => {
    render(<ErrorBanner message="x" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('fires onRetry with the supplied label', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<ErrorBanner message="x" onRetry={onRetry} retryLabel="Try again" />);
    await user.click(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('fires onDismiss and exposes the dismiss label as aria-label', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<ErrorBanner message="x" onDismiss={onDismiss} dismissLabel="Close" />);
    const btn = screen.getByRole('button', { name: 'Close' });
    await user.click(btn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
