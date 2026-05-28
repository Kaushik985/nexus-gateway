import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { OrgTreeSelect } from '@/components/ui/OrgTreeSelect/OrgTreeSelect';

const tree = [
  { id: 'org-1', name: 'Acme', code: 'ACME', enabled: true, children: [
    { id: 'org-2', name: 'Sub', code: 'SUB', enabled: true, children: [] },
  ] },
];

const treeFns = vi.hoisted(() => ({
  setSearchQuery: vi.fn(), toggleExpand: vi.fn(), expandNode: vi.fn(), collapseNode: vi.fn(),
}));
vi.mock('@/components/ui/OrgTreeSelect/useOrgTree', () => ({
  useOrgTree: () => ({
    loading: false,
    visibleTree: tree,
    matchedIds: new Set<string>(),
    searchQuery: '',
    setSearchQuery: treeFns.setSearchQuery,
    expandedIds: new Set(['org-1']),
    toggleExpand: treeFns.toggleExpand,
    expandNode: treeFns.expandNode,
    collapseNode: treeFns.collapseNode,
    getLabel: (id: string) => (id === 'org-1' ? 'Acme' : id === 'org-2' ? 'Sub' : id),
    getDescendantIds: (id: string) => (id === 'org-1' ? ['org-2'] : []),
    getParentId: (id: string) => (id === 'org-2' ? 'org-1' : null),
    areSomeChildrenSelected: () => false,
    findNode: (id: string) => (id === 'org-1' ? tree[0] : id === 'org-2' ? tree[0].children[0] : null),
  }),
  flattenVisibleIds: () => ['org-1', 'org-2'],
}));

function wrap(props: Partial<React.ComponentProps<typeof OrgTreeSelect>>) {
  const onChange = props.onChange ?? vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <OrgTreeSelect value="" onChange={onChange} {...props} />
    </I18nextProvider>,
  );
  return onChange as ReturnType<typeof vi.fn>;
}

describe('OrgTreeSelect — single mode', () => {
  it('opens the tree on trigger click and selects a node', () => {
    const onChange = wrap({ mode: 'single', value: '' });
    fireEvent.click(screen.getByRole('combobox'));
    // tree rows render once open
    fireEvent.click(screen.getByText('Acme'));
    expect(onChange).toHaveBeenCalledWith('org-1');
  });

  it('shows the selected label and clears it', () => {
    const onChange = wrap({ mode: 'single', value: 'org-1' });
    // the trigger reflects the resolved label
    expect(screen.getByText('Acme')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:orgTreeSelect.clear') }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('does not open when disabled', () => {
    wrap({ mode: 'single', value: '', disabled: true });
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
  });
});

describe('OrgTreeSelect — multiple mode', () => {
  it('renders a tag per selected id and removes one', () => {
    const onChange = wrap({ mode: 'multiple', value: ['org-1', 'org-2'] });
    // each selected id renders a removable tag (label + ×)
    const tag = screen.getAllByText('Acme')[0].closest('span')!;
    fireEvent.click(within(tag).getByRole('button', { name: i18n.t('common:remove') }));
    expect(onChange).toHaveBeenCalledWith(['org-2']);
  });

  it('toggles a node without cascade', () => {
    const onChange = wrap({ mode: 'multiple', value: [] });
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByText('Sub'));
    expect(onChange).toHaveBeenCalledWith(['org-2']);
  });

  it('cascade selecting a parent also selects its descendants', () => {
    const onChange = wrap({ mode: 'multiple', cascade: true, value: [] });
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByText('Acme'));
    // parent + its descendant both flow into onChange
    const arg = onChange.mock.calls[0][0] as string[];
    expect(arg).toEqual(expect.arrayContaining(['org-1', 'org-2']));
  });
});

describe('OrgTreeSelect — keyboard navigation', () => {
  beforeEach(() => { treeFns.collapseNode.mockClear(); treeFns.setSearchQuery.mockClear(); });

  it('ArrowDown opens the tree when closed', () => {
    wrap({ mode: 'single', value: '' });
    const combo = screen.getByRole('combobox');
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    expect(screen.getByRole('tree')).toBeInTheDocument();
  });

  it('ArrowDown then Enter selects the focused node', () => {
    const onChange = wrap({ mode: 'single', value: '' });
    const combo = screen.getByRole('combobox');
    fireEvent.keyDown(combo, { key: 'ArrowDown' }); // open
    fireEvent.keyDown(combo, { key: 'ArrowDown' }); // focus first visible (org-1)
    fireEvent.keyDown(combo, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('org-1');
  });

  it('ArrowLeft on a focused expanded node collapses it', () => {
    wrap({ mode: 'single', value: '' });
    const combo = screen.getByRole('combobox');
    fireEvent.keyDown(combo, { key: 'ArrowDown' }); // open
    fireEvent.keyDown(combo, { key: 'ArrowDown' }); // focus org-1 (expanded)
    fireEvent.keyDown(combo, { key: 'ArrowLeft' });
    expect(treeFns.collapseNode).toHaveBeenCalledWith('org-1');
  });

  it('Escape closes the open tree', () => {
    wrap({ mode: 'single', value: '' });
    const combo = screen.getByRole('combobox');
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    expect(screen.getByRole('tree')).toBeInTheDocument();
    fireEvent.keyDown(combo, { key: 'Escape' });
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
  });

  it('typing in the search box drives the query setter', () => {
    wrap({ mode: 'single', value: '' });
    fireEvent.click(screen.getByRole('combobox'));
    const search = screen.getByRole('textbox');
    fireEvent.change(search, { target: { value: 'acm' } });
    expect(treeFns.setSearchQuery).toHaveBeenCalledWith('acm');
  });
});
