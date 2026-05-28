import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useOrgTree, flattenVisibleIds } from '../../../../src/components/ui/OrgTreeSelect/useOrgTree';

const tree = vi.fn();
vi.mock('@/api/services', () => ({ organizationApi: { tree: () => tree() } }));

const TREE = [
  { id: '1', name: 'Root', code: 'R', enabled: true, children: [
    { id: '2', name: 'Alpha', code: 'AL', enabled: true, children: [] },
    { id: '3', name: 'Beta', code: 'BE', enabled: true, children: [
      { id: '4', name: 'Gamma', code: 'GA', enabled: true, children: [] },
    ] },
  ] },
];

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

async function mount(opts?: { excludeIds?: string[] }) {
  const r = renderHook(() => useOrgTree(opts), { wrapper: wrapper() });
  await waitFor(() => expect(r.result.current.loading).toBe(false));
  return r;
}

describe('useOrgTree', () => {
  beforeEach(() => tree.mockResolvedValue({ data: TREE }));

  it('loads + converts the org tree', async () => {
    const { result } = await mount();
    expect(result.current.fullTree).toHaveLength(1);
    expect(result.current.fullTree[0].children).toHaveLength(2);
  });

  it('getLabel / getParentId / getDescendantIds traverse the tree', async () => {
    const { result } = await mount();
    expect(result.current.getLabel('4')).toBe('Gamma (GA)');
    expect(result.current.getLabel('nope')).toBe('nope');
    expect(result.current.getParentId('4')).toBe('3');
    expect(result.current.getParentId('1')).toBeNull();
    expect(result.current.getDescendantIds('1').sort()).toEqual(['2', '3', '4']);
    expect(result.current.getDescendantIds('2')).toEqual([]);
  });

  it('toggleExpand / expandNode / collapseNode manage expansion', async () => {
    const { result } = await mount();
    act(() => result.current.toggleExpand('1'));
    expect(result.current.expandedIds.has('1')).toBe(true);
    act(() => result.current.toggleExpand('1'));
    expect(result.current.expandedIds.has('1')).toBe(false);
    act(() => result.current.expandNode('3'));
    expect(result.current.expandedIds.has('3')).toBe(true);
    act(() => result.current.collapseNode('3'));
    expect(result.current.expandedIds.has('3')).toBe(false);
  });

  it('search filters the tree, marks matches, and auto-expands ancestors', async () => {
    const { result } = await mount();
    act(() => result.current.setSearchQuery('Gamma'));
    await waitFor(() => expect(result.current.matchedIds.has('4')).toBe(true));
    // Only the Root→Beta→Gamma branch survives.
    expect(result.current.visibleTree).toHaveLength(1);
    expect(result.current.visibleTree[0].children).toHaveLength(1);
    expect(result.current.visibleTree[0].children[0].id).toBe('3');
    // Ancestors auto-expanded.
    expect(result.current.expandedIds.has('1')).toBe(true);
    expect(result.current.expandedIds.has('3')).toBe(true);
  });

  it('areSomeChildrenSelected reports the indeterminate case', async () => {
    const { result } = await mount();
    expect(result.current.areSomeChildrenSelected('1', new Set(['2']))).toBe(true);
    expect(result.current.areSomeChildrenSelected('1', new Set(['2', '3']))).toBe(false);
    expect(result.current.areSomeChildrenSelected('2', new Set())).toBe(false);
  });

  it('excludeIds drops the excluded subtree', async () => {
    const { result } = await mount({ excludeIds: ['3'] });
    expect(result.current.findNode('3')).toBeNull();
    expect(result.current.findNode('4')).toBeNull();
    expect(result.current.findNode('2')).not.toBeNull();
  });
});

describe('flattenVisibleIds', () => {
  it('includes children only for expanded nodes', () => {
    const nodes = [
      { id: '1', name: 'a', code: 'a', enabled: true, children: [
        { id: '2', name: 'b', code: 'b', enabled: true, children: [] },
      ] },
    ];
    expect(flattenVisibleIds(nodes, new Set())).toEqual(['1']);
    expect(flattenVisibleIds(nodes, new Set(['1']))).toEqual(['1', '2']);
  });
});
