import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { SearchableCombobox, type ComboboxOption } from '../../../../src/components/ui/SearchableCombobox/SearchableCombobox';

const OPTS: ComboboxOption[] = [
  { id: '1', label: 'Alpha' },
  { id: '2', label: 'Beta' },
  { id: '3', label: 'Gamma' },
];

function setup(over: Partial<React.ComponentProps<typeof SearchableCombobox>> = {}) {
  const onSelect = vi.fn();
  const fetchOptions = vi.fn().mockResolvedValue(OPTS);
  render(
    <I18nextProvider i18n={i18n}>
      <SearchableCombobox
        valueId=""
        valueLabel=""
        placeholder="search…"
        ariaLabel="picker"
        fetchOptions={fetchOptions}
        onSelect={onSelect}
        {...over}
      />
    </I18nextProvider>,
  );
  return { onSelect, fetchOptions };
}

describe('SearchableCombobox', () => {
  it('fetches (debounced) on type and renders options', async () => {
    const { fetchOptions } = setup();
    const input = screen.getByRole('combobox', { name: 'picker' });
    await userEvent.type(input, 'al');
    expect(await screen.findByRole('option', { name: 'Alpha' })).toBeInTheDocument();
    expect(fetchOptions).toHaveBeenCalledWith('al');
  });

  it('selects an option on click → onSelect + closes', async () => {
    const { onSelect } = setup();
    await userEvent.type(screen.getByRole('combobox', { name: 'picker' }), 'a');
    const opt = await screen.findByRole('option', { name: 'Beta' });
    await userEvent.click(opt);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: '2', label: 'Beta' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('clears the selection via the inline clear button', async () => {
    const { onSelect } = setup({ valueId: '2', valueLabel: 'Beta' });
    await userEvent.click(screen.getByRole('button', { name: i18n.t('common:clear') }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('keyboard ArrowDown opens + highlights, Enter selects', async () => {
    const { onSelect } = setup({ allowEmptyQueryFetch: true });
    const input = screen.getByRole('combobox', { name: 'picker' });
    input.focus();
    await screen.findByRole('option', { name: 'Alpha' });
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // highlight 0
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // highlight 1
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }));
  });

  it('Escape closes the open listbox', async () => {
    setup({ allowEmptyQueryFetch: true });
    const input = screen.getByRole('combobox', { name: 'picker' });
    input.focus();
    await screen.findByRole('listbox');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('shows "Type to search" when empty and empty-fetch is disabled', async () => {
    setup();
    screen.getByRole('combobox', { name: 'picker' }).focus();
    expect(await screen.findByText('Type to search')).toBeInTheDocument();
  });

  it('renders no matches when fetch rejects', async () => {
    const onSelect = vi.fn();
    const fetchOptions = vi.fn().mockRejectedValue(new Error('boom'));
    render(
      <I18nextProvider i18n={i18n}>
        <SearchableCombobox valueId="" valueLabel="" placeholder="p" ariaLabel="picker"
          fetchOptions={fetchOptions} onSelect={onSelect} allowEmptyQueryFetch />
      </I18nextProvider>,
    );
    screen.getByRole('combobox', { name: 'picker' }).focus();
    expect(await screen.findByText('No matches')).toBeInTheDocument();
  });
});
