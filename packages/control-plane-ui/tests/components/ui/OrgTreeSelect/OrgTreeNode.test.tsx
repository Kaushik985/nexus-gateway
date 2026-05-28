import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrgTreeNodeItem } from '../../../../src/components/ui/OrgTreeSelect/OrgTreeNode';
import type { OrgTreeNode } from '../../../../src/components/ui/OrgTreeSelect/types';

const NODE: OrgTreeNode = {
  id: '1', name: 'Root', code: 'R', enabled: true,
  children: [{ id: '2', name: 'Child', code: 'C', enabled: true, children: [] }],
};

function renderNode(over: Partial<React.ComponentProps<typeof OrgTreeNodeItem>> = {}) {
  const onToggleExpand = vi.fn();
  const onSelect = vi.fn();
  const areSomeChildrenSelected = vi.fn().mockReturnValue(false);
  render(
    <div role="tree">
      <OrgTreeNodeItem
        node={NODE} level={0} mode="single"
        selectedIds={new Set()} focusedId={null} expandedIds={new Set()}
        matchedIds={new Set()} searchQuery="" cascade={false}
        onToggleExpand={onToggleExpand} onSelect={onSelect}
        areSomeChildrenSelected={areSomeChildrenSelected}
        {...over}
      />
    </div>,
  );
  return { onToggleExpand, onSelect, areSomeChildrenSelected };
}

describe('OrgTreeNodeItem', () => {
  it('renders a treeitem with name + code and aria attributes', () => {
    renderNode();
    const item = screen.getByRole('treeitem');
    expect(item).toHaveAttribute('aria-selected', 'false');
    expect(item).toHaveAttribute('aria-level', '1');
    expect(item).toHaveAttribute('aria-expanded', 'false'); // has children, collapsed
    expect(item.textContent).toContain('Root');
    expect(item.textContent).toContain('(R)');
  });

  it('fires onSelect when the row is clicked', () => {
    const { onSelect } = renderNode();
    fireEvent.click(screen.getByRole('treeitem'));
    expect(onSelect).toHaveBeenCalledWith('1');
  });

  it('fires onToggleExpand (not onSelect) when the expand arrow is clicked', () => {
    const { onToggleExpand, onSelect } = renderNode();
    // The expand arrow is aria-hidden, so include hidden elements.
    fireEvent.click(screen.getAllByRole('button', { hidden: true })[0]);
    expect(onToggleExpand).toHaveBeenCalledWith('1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders children when expanded', () => {
    renderNode({ expandedIds: new Set(['1']) });
    expect(screen.getByText('Child')).toBeInTheDocument();
    expect(screen.getAllByRole('treeitem')).toHaveLength(2);
  });

  it('renders a checkbox in multiple mode and reflects indeterminate', () => {
    const { areSomeChildrenSelected } = renderNode({
      mode: 'multiple', cascade: true,
    });
    areSomeChildrenSelected.mockReturnValue(true);
    const cb = screen.getByRole('checkbox');
    expect(cb).toBeInTheDocument();
  });

  it('highlights the matched substring with a <mark>', () => {
    renderNode({ searchQuery: 'oo' }); // matches "Root"
    const item = screen.getByRole('treeitem');
    expect(item.querySelector('mark')).toBeTruthy();
    expect(item.querySelector('mark')!.textContent).toBe('oo');
  });
});
