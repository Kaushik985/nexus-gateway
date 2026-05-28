import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { NotFoundPage } from '../../src/pages/NotFoundPage';

describe('NotFoundPage', () => {
  it('renders the 404 heading and a dashboard link', () => {
    render(
      <I18nextProvider i18n={i18n}><MemoryRouter><NotFoundPage /></MemoryRouter></I18nextProvider>,
    );
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/');
  });
});
