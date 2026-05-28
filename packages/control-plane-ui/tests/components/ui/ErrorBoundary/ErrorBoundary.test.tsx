import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ErrorBoundary } from '../../../../src/components/ui/ErrorBoundary/ErrorBoundary';

function Boom({ when = true }: { when?: boolean }): React.ReactElement {
  if (when) throw new Error('kaboom');
  return <div>safe-content</div>;
}
const wrap = (ui: React.ReactElement) => render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

describe('ErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders children when nothing throws', () => {
    wrap(<ErrorBoundary><div>ok-child</div></ErrorBoundary>);
    expect(screen.getByText('ok-child')).toBeInTheDocument();
  });

  it('renders the default route fallback + calls onError when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    wrap(
      <ErrorBoundary level="route" onError={onError}>
        <Boom />
      </ErrorBoundary>,
    );
    // Default fallback renders a retry button; the safe content is gone.
    expect(screen.queryByText('safe-content')).toBeNull();
    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Error).message).toBe('kaboom');
  });

  it('renders a static fallback node', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    wrap(
      <ErrorBoundary fallback={<div>custom-fallback</div>}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('custom-fallback')).toBeInTheDocument();
  });

  it('renders a render-prop fallback and reset() clears the error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    let throwIt = true;
    function Toggle() {
      if (throwIt) throw new Error('x');
      return <div>recovered</div>;
    }
    wrap(
      <ErrorBoundary
        fallback={(err, reset) => (
          <button onClick={() => { throwIt = false; reset(); }}>reset {err.message}</button>
        )}
      >
        <Toggle />
      </ErrorBoundary>,
    );
    expect(screen.getByText('reset x')).toBeInTheDocument();
    await user.click(screen.getByText('reset x'));
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });
});
