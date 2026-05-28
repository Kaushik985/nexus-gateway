import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { LanguagePicker } from '../../src/components/LanguagePicker';

describe('LanguagePicker', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders the three supported locales', () => {
    render(<I18nextProvider i18n={i18n}><LanguagePicker /></I18nextProvider>);
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '中文' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Español' })).toBeInTheDocument();
  });

  it('changes the language and persists the choice on select', async () => {
    const changeLanguage = vi.spyOn(i18n, 'changeLanguage');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const user = userEvent.setup();
    render(<I18nextProvider i18n={i18n}><LanguagePicker /></I18nextProvider>);
    await user.selectOptions(screen.getByRole('combobox'), 'zh');
    expect(changeLanguage).toHaveBeenCalledWith('zh');
    expect(setItem).toHaveBeenCalledWith('nexusLang', 'zh');
  });
});
