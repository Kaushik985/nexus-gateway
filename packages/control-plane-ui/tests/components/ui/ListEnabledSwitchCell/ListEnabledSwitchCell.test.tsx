import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ListEnabledSwitchCell } from '../../../../src/components/ui/ListEnabledSwitchCell/ListEnabledSwitchCell';

const wrap = (ui: React.ReactElement) => render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

describe('ListEnabledSwitchCell', () => {
  it('renders a badge-only cell (no switch) when not toggleable', () => {
    wrap(<ListEnabledSwitchCell enabled canToggle={false} onToggle={() => {}} ariaLabel="row" />);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText(i18n.t('common:enabled'))).toBeInTheDocument();
  });

  it('renders a switch + status when toggleable and fires onToggle on flip', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    wrap(<ListEnabledSwitchCell enabled={false} canToggle onToggle={onToggle} ariaLabel="my-rule" />);
    const sw = screen.getByRole('switch', { name: 'my-rule' });
    await user.click(sw);
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(screen.getByText(i18n.t('common:disabled'))).toBeInTheDocument();
  });

  it('does not fire onToggle when disabled', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    wrap(<ListEnabledSwitchCell enabled canToggle toggleDisabled onToggle={onToggle} ariaLabel="r" />);
    await user.click(screen.getByRole('switch', { name: 'r' }));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
