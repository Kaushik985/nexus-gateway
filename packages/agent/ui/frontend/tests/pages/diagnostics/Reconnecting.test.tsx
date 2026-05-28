import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { Reconnecting } from '@/pages/diagnostics/Reconnecting';
describe('Reconnecting', () => {
  it('renders the finishing-setup screen', () => {
    render(<I18nextProvider i18n={i18n}><Reconnecting /></I18nextProvider>);
    expect(screen.getByRole('heading')).toBeInTheDocument();
  });
});
