import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { CatalogPicker } from '@/pages/iam/_shared/CatalogPicker';

const catalog = {
  resources: [
    { service: 'gateway', type: 'provider', nrn: 'nrn:provider', actions: [{ name: 'admin:provider.create' }, { name: 'admin:provider.read' }] },
    { service: 'gateway', type: 'model', nrn: 'nrn:model', actions: [{ name: 'admin:model.read' }] },
    { service: 'iam', type: 'policy', nrn: 'nrn:policy', actions: [{ name: 'admin:policy.read' }] },
  ],
} as never;

function setup(currentActions: string[]) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <CatalogPicker catalog={catalog} currentActions={currentActions} onChange={onChange} onClose={onClose} />
    </I18nextProvider>,
  );
  return { onChange, onClose };
}

// The filter box auto-expands every service + resource when non-empty, so
// typing a broad query surfaces all verb checkboxes without manual chevrons.
function expandAll() {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'admin' } });
}

function verbCheckbox(name: string): HTMLInputElement {
  const label = screen.getByText(name).closest('label')!;
  return within(label).getByRole('checkbox') as HTMLInputElement;
}

describe('CatalogPicker', () => {
  it('admin:* master selects the global wildcard and drops other admin: entries', () => {
    const { onChange } = setup(['admin:provider.read']);
    const adminStar = screen.getByText('admin:*').closest('label')!;
    fireEvent.click(within(adminStar).getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(['admin:*']);
  });

  it('un-checking admin:* removes only the wildcard', () => {
    const { onChange } = setup(['admin:*', 'something:else']);
    const adminStar = screen.getByText('admin:*').closest('label')!;
    fireEvent.click(within(adminStar).getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(['something:else']);
  });

  it('toggling an individual verb adds that action', () => {
    const { onChange } = setup([]);
    expandAll();
    fireEvent.click(verbCheckbox('admin:provider.create'));
    expect(onChange).toHaveBeenCalledWith(['admin:provider.create']);
  });

  it('toggling a verb already covered by its resource wildcard expands the siblings minus the cleared one', () => {
    const { onChange } = setup(['admin:provider.*']);
    expandAll();
    // un-checking provider.create while provider.* is set → expand to the
    // remaining sibling verbs (read) and drop the wildcard.
    fireEvent.click(verbCheckbox('admin:provider.create'));
    expect(onChange).toHaveBeenCalledWith(['admin:provider.read']);
  });

  it('resource master selects the compact wildcard when nothing is selected', () => {
    const { onChange } = setup([]);
    expandAll();
    const master = screen.getByText('provider').closest('label')!;
    fireEvent.click(within(master).getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(['admin:provider.*']);
  });

  it('resource master clears the resource when its wildcard is set', () => {
    const { onChange } = setup(['admin:provider.*']);
    expandAll();
    const master = screen.getByText('provider').closest('label')!;
    fireEvent.click(within(master).getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('service master selects every resource wildcard in that service', () => {
    const { onChange } = setup([]);
    expandAll();
    // gateway groups provider + model
    const svc = screen.getByText(i18n.t('pages:iam.services.gateway', { defaultValue: 'gateway' })).closest('label')!;
    fireEvent.click(within(svc).getByRole('checkbox'));
    // resources are sorted alphabetically within the service (model < provider)
    expect(onChange).toHaveBeenCalledWith(['admin:model.*', 'admin:provider.*']);
  });

  it('filter with no match renders the empty state', () => {
    setup([]);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz-nope' } });
    expect(screen.getByText(i18n.t('pages:iam.catalogPickerNoMatch'))).toBeInTheDocument();
  });

  it('the × close button invokes onClose', () => {
    const { onClose } = setup([]);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.catalogPickerClose') }));
    expect(onClose).toHaveBeenCalled();
  });
});
