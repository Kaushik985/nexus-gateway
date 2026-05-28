import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithRouter } from '@/test/test-utils';
import InfraDlqPage from '@/pages/infrastructure/dlq/InfraDlqPage';

const dlq = vi.hoisted(() => ({ dlqApi: { list: vi.fn(), retry: vi.fn() } }));
vi.mock('@/api/services/infrastructure/dlq/dlq', () => dlq);
// Operator with manage permission so the retry column renders.
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => true }));

const row = {
  id: 'dlq-1',
  msgId: 'msg-1',
  subject: 'traffic.event.v1',
  // 7 avoids colliding with page-size options (5/10/20/50/100), page pills,
  // and the total — so getByText below uniquely hits the delivery badge.
  deliveryCount: 7,
  payloadSize: 2048,
  lastError: 'publish timeout',
  firstSeenAt: '2026-05-28T00:00:00Z',
  dlqInsertedAt: '2026-05-28T00:00:00Z',
};

describe('InfraDlqPage', () => {
  beforeEach(() => {
    // total > limit so the offset footer's Next control is enabled.
    dlq.dlqApi.list.mockReset().mockResolvedValue({ rows: [row], total: 25 });
    dlq.dlqApi.retry.mockReset().mockResolvedValue({ ok: true, subject: 'traffic.event.v1' });
  });
  afterEach(() => vi.restoreAllMocks());

  it('loads the first page (offset 0, default limit) and renders a DLQ row', async () => {
    renderWithRouter(<InfraDlqPage />);
    await waitFor(() => expect(dlq.dlqApi.list).toHaveBeenCalled());
    expect(dlq.dlqApi.list).toHaveBeenCalledWith(expect.objectContaining({ offset: 0, limit: 10 }));
    await waitFor(() => expect(screen.getByText('traffic.event.v1')).toBeInTheDocument());
    expect(screen.getByText('7')).toBeInTheDocument(); // deliveryCount badge
    expect(screen.getByText('2.0 KB')).toBeInTheDocument(); // payloadSize formatted
  });

  it('renders the shared offset-pagination footer driven by the server total', async () => {
    renderWithRouter(<InfraDlqPage />);
    await waitFor(() => expect(screen.getByText('traffic.event.v1')).toBeInTheDocument());
    // ListPagination renders a navigation region with First/Prev/Next/Last —
    // the shared control every admin list page uses.
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  it('Next advances the offset by the page size (server-side paging)', async () => {
    renderWithRouter(<InfraDlqPage />);
    await waitFor(() => expect(screen.getByText('traffic.event.v1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^next/i }));
    await waitFor(() =>
      expect(dlq.dlqApi.list).toHaveBeenCalledWith(expect.objectContaining({ offset: 10, limit: 10 })),
    );
  });

  it('retry asks for confirmation then calls dlqApi.retry with the row id', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithRouter(<InfraDlqPage />);
    await waitFor(() => expect(screen.getByText('traffic.event.v1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(dlq.dlqApi.retry).toHaveBeenCalledWith('dlq-1'));
  });

  it('retry is a no-op when the operator cancels the confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderWithRouter(<InfraDlqPage />);
    await waitFor(() => expect(screen.getByText('traffic.event.v1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(dlq.dlqApi.retry).not.toHaveBeenCalled();
  });

  it('surfaces an error banner when the list call rejects', async () => {
    dlq.dlqApi.list.mockReset().mockRejectedValue(new Error('hub unreachable'));
    renderWithRouter(<InfraDlqPage />);
    // useApi retries once (~1s backoff) before surfacing the error, so allow
    // more than waitFor's 1s default.
    await waitFor(() => expect(screen.getByText('hub unreachable')).toBeInTheDocument(), { timeout: 3000 });
  });
});
