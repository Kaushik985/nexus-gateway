import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { MultiSelectDropdown, type MultiSelectOption } from '../../../../src/components/ui/MultiSelectDropdown/MultiSelectDropdown';

const OPTS: MultiSelectOption[] = [
  { value: 'a', label: 'Apple', group: 'Fruit' },
  { value: 'b', label: 'Banana', group: 'Fruit' },
  { value: 'c', label: 'Carrot', group: 'Veg' },
];

function setup(over: Partial<React.ComponentProps<typeof MultiSelectDropdown>> = {}) {
  const onChange = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <MultiSelectDropdown label="Items" options={OPTS} value={[]} onChange={onChange} {...over} />
    </I18nextProvider>,
  );
  return { onChange };
}

describe('MultiSelectDropdown', () => {
  it('shows the empty placeholder and opens on trigger click', async () => {
    setup({ emptyLabel: 'Pick some' });
    expect(screen.getByRole('button')).toHaveTextContent('Pick some');
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('summarizes the selected labels', () => {
    setup({ value: ['a', 'c'] });
    expect(screen.getByRole('button')).toHaveTextContent('Apple, Carrot');
  });

  it('adds a value when an unchecked option is clicked', async () => {
    const { onChange } = setup({ value: [] });
    await userEvent.click(screen.getByRole('button'));
    await userEvent.click(screen.getByRole('option', { name: /Banana/ }));
    expect(onChange).toHaveBeenCalledWith(['b']);
  });

  it('removes a value when a checked option is clicked', async () => {
    const { onChange } = setup({ value: ['a'] });
    await userEvent.click(screen.getByRole('button'));
    await userEvent.click(screen.getByRole('option', { name: /Apple/ }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('renders group headers when options are grouped', async () => {
    setup();
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Fruit')).toBeInTheDocument();
    expect(screen.getByText('Veg')).toBeInTheDocument();
  });

  it('filters options via the inline search', async () => {
    setup({ searchable: true });
    await userEvent.click(screen.getByRole('button'));
    await userEvent.type(screen.getByRole('textbox'), 'carr');
    expect(screen.getByRole('option', { name: /Carrot/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Apple/ })).toBeNull();
  });

  it('shows the no-options message when the filter matches nothing', async () => {
    setup({ searchable: true });
    await userEvent.click(screen.getByRole('button'));
    await userEvent.type(screen.getByRole('textbox'), 'zzz');
    expect(screen.getByText(i18n.t('common:multiSelect.noOptions'))).toBeInTheDocument();
  });

  it('does not open when disabled', async () => {
    setup({ disabled: true });
    await userEvent.click(screen.getByRole('button'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
