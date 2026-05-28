import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { Breadcrumb } from '../../../../src/components/ui/Breadcrumb/Breadcrumb';

const wrap = (ui: React.ReactElement) =>
  render(<I18nextProvider i18n={i18n}><MemoryRouter>{ui}</MemoryRouter></I18nextProvider>);

describe('Breadcrumb', () => {
  it('renders nothing for an empty trail', () => {
    const { container } = wrap(<Breadcrumb items={[]} />);
    expect(container.querySelector('nav')).toBeNull();
  });
  it('renders intermediate items as links and the last as current page', () => {
    wrap(<Breadcrumb items={[{ label: 'Providers', to: '/config/providers' }, { label: 'OpenAI' }]} />);
    const link = screen.getByRole('link', { name: 'Providers' });
    expect(link).toHaveAttribute('href', '/config/providers');
    const current = screen.getByText('OpenAI');
    expect(current).toHaveAttribute('aria-current', 'page');
  });
});
