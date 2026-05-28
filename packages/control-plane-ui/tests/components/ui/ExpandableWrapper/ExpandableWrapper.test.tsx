import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ExpandableWrapper } from '../../../../src/components/ui/ExpandableWrapper/ExpandableWrapper';

const wrap = (ui: React.ReactElement) => render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

describe('ExpandableWrapper', () => {
  it('opens a full-screen dialog on expand and closes on the close button', async () => {
    const user = userEvent.setup();
    wrap(<ExpandableWrapper><p>chart-body</p></ExpandableWrapper>);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: i18n.t('common:expandFullScreen') }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: i18n.t('common:closeExpandedView') }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the expanded view on Escape', async () => {
    const user = userEvent.setup();
    wrap(<ExpandableWrapper><p>x</p></ExpandableWrapper>);
    await user.click(screen.getByRole('button', { name: i18n.t('common:expandFullScreen') }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
