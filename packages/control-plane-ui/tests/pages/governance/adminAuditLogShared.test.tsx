import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import {
  relativeTime, buildAdminAuditLogColumns, CopyJsonButton,
  AdminAuditEntryDrawer, AdminAuditLogTable,
} from '@/pages/governance/adminAuditLogShared';
import type { AdminAuditEntry } from '@/api/types';

const t = (k: string) => k;
const entry = {
  id: 'a1', actorLabel: 'alice@nexus.ai', entityType: 'Provider', entityId: 'prov-1',
  action: 'provider.update', timestamp: new Date(Date.now() - 5000).toISOString(),
} as unknown as AdminAuditEntry;

function I18n({ children }: { children: React.ReactNode }) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

describe('relativeTime', () => {
  it('buckets the delta into s/m/h/d/mo with a just-now floor', () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    expect(relativeTime(ago(-1000))).toBe('just now'); // future
    expect(relativeTime(ago(5_000))).toBe('5s ago');
    expect(relativeTime(ago(5 * 60_000))).toBe('5m ago');
    expect(relativeTime(ago(3 * 3600_000))).toBe('3h ago');
    expect(relativeTime(ago(2 * 86400_000))).toBe('2d ago');
    expect(relativeTime(ago(60 * 86400_000))).toBe('2mo ago');
  });
});

describe('buildAdminAuditLogColumns', () => {
  it('includes the actor column by default and drops it when hideActor', () => {
    expect(buildAdminAuditLogColumns(t).map((c) => c.key)).toContain('actorLabel');
    expect(buildAdminAuditLogColumns(t, { hideActor: true }).map((c) => c.key)).not.toContain('actorLabel');
  });

  it('entityId + time render functions produce cells', () => {
    const cols = new Map(buildAdminAuditLogColumns(t).map((c) => [c.key, c]));
    const { getByText } = render(<>{cols.get('entityId')!.render!(entry)}</>);
    expect(getByText('prov-1')).toBeInTheDocument();
    const time = render(<>{cols.get('timestamp')!.render!(entry)}</>);
    expect(time.getByText(/ago|just now/)).toBeInTheDocument();
  });

  it('entityId render falls back to an em-dash when missing', () => {
    const cols = new Map(buildAdminAuditLogColumns(t).map((c) => [c.key, c]));
    const { getByText } = render(<>{cols.get('entityId')!.render!({ ...entry, entityId: null } as AdminAuditEntry)}</>);
    expect(getByText('—')).toBeInTheDocument();
  });
});

describe('CopyJsonButton', () => {
  beforeEach(() => { Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } }); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('copies the json then reverts the label after the timeout', () => {
    render(<I18n><CopyJsonButton json='{"a":1}' /></I18n>);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('{"a":1}');
    expect(btn.textContent).toBe(i18n.t('pages:audit.copied'));
    act(() => { vi.advanceTimersByTime(1600); });
    expect(btn.textContent).toBe(i18n.t('pages:audit.copyJson'));
  });
});

describe('AdminAuditEntryDrawer', () => {
  it('renders the entry fields + before/after JSON state blocks', () => {
    const withState = { ...entry, beforeState: { enabled: false }, afterState: { enabled: true } } as unknown as AdminAuditEntry;
    render(<I18n><AdminAuditEntryDrawer selectedEntry={withState} drawerVisible onClose={vi.fn()} /></I18n>);
    expect(screen.getByText('alice@nexus.ai')).toBeInTheDocument();
    expect(screen.getByText('provider.update')).toBeInTheDocument();
    // both state blocks render their JSON
    expect(screen.getAllByText(/"enabled"/).length).toBeGreaterThanOrEqual(2);
  });

  it('omits the actor field when hideActor', () => {
    render(<I18n><AdminAuditEntryDrawer selectedEntry={entry} drawerVisible hideActor onClose={vi.fn()} /></I18n>);
    expect(screen.queryByText('alice@nexus.ai')).not.toBeInTheDocument();
  });

  it('close button invokes onClose', () => {
    const onClose = vi.fn();
    render(<I18n><AdminAuditEntryDrawer selectedEntry={entry} drawerVisible onClose={onClose} /></I18n>);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:audit.closeDetailPanel') }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('AdminAuditLogTable', () => {
  it('selects a fresh row and toggles the already-selected row', () => {
    const onSelectEntry = vi.fn();
    const onToggleEntry = vi.fn();
    const { rerender } = render(
      <I18n><AdminAuditLogTable entries={[entry]} selectedEntry={null} onSelectEntry={onSelectEntry} onToggleEntry={onToggleEntry} /></I18n>,
    );
    fireEvent.click(screen.getByText('provider.update'));
    expect(onSelectEntry).toHaveBeenCalledWith(entry);
    // when the row is already selected, clicking toggles instead
    rerender(<I18n><AdminAuditLogTable entries={[entry]} selectedEntry={entry} onSelectEntry={onSelectEntry} onToggleEntry={onToggleEntry} /></I18n>);
    fireEvent.click(screen.getByText('provider.update'));
    expect(onToggleEntry).toHaveBeenCalledWith(entry);
  });
});
