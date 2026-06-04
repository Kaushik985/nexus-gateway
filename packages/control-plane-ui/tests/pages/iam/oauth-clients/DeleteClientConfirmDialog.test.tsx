/**
 * DeleteClientConfirmDialog — type-to-confirm destructive dialog. Delete
 * stays disabled until the typed input exactly matches the client id; that
 * gate plus the activeRefreshTokenCount interpolation are the load-bearing
 * pieces a future refactor must not silently drop.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { DeleteClientConfirmDialog } from '../../../../src/pages/iam/oauth-clients/components/DeleteClientConfirmDialog';

function setup(opts: Partial<{
  open: boolean;
  clientId: string;
  count: number;
  loading: boolean;
}> = {}) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  renderWithProviders(
    <DeleteClientConfirmDialog
      open={opts.open ?? true}
      clientId={opts.clientId ?? 'my-app'}
      activeRefreshTokenCount={opts.count ?? 3}
      loading={opts.loading ?? false}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  return { onCancel, onConfirm };
}

describe('DeleteClientConfirmDialog', () => {
  it('disables Delete until the typed id exactly matches', () => {
    const { onConfirm } = setup({ clientId: 'my-app' });

    const deleteBtn = screen.getByRole('button', { name: /Delete client/i });
    expect(deleteBtn).toBeDisabled();

    const input = screen.getByLabelText(/Type my-app to confirm/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'my-ap' } });
    expect(deleteBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: 'my-app' } });
    expect(deleteBtn).toBeEnabled();

    fireEvent.click(deleteBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('surfaces the activeRefreshTokenCount in the body', () => {
    setup({ clientId: 'my-app', count: 7 });
    expect(screen.getByText(/7 active refresh tokens will be revoked/i)).toBeInTheDocument();
  });

  it('fires onCancel when the Cancel button is clicked', () => {
    const { onCancel, onConfirm } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('stays disabled when loading=true even after the id matches', () => {
    setup({ clientId: 'my-app', loading: true });
    const input = screen.getByLabelText(/Type my-app to confirm/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'my-app' } });
    expect(screen.getByRole('button', { name: /Delete client/i })).toBeDisabled();
  });

  it('resets the typed value when the dialog is reopened', () => {
    const { onCancel: onCancel1 } = setup({ open: true, clientId: 'my-app' });
    const input = screen.getByLabelText(/Type my-app to confirm/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'my-app' } });
    expect(screen.getByRole('button', { name: /Delete client/i })).toBeEnabled();
    expect(onCancel1).not.toHaveBeenCalled();

    cleanup();
    setup({ open: true, clientId: 'my-app' });
    expect(screen.getByRole('button', { name: /Delete client/i })).toBeDisabled();
  });
});
