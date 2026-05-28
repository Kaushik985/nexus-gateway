import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import InfraJobDetailPage from '@/pages/infrastructure/jobs/InfraJobDetailPage';

const mutateCalls: unknown[] = [];

const job = {
  id: 'job-1',
  name: 'cost-rollup',
  description: 'rolls up cost daily',
  interval: 3_600_000_000_000, // 1h in ns
  lastStatus: 'success',
  lastRun: '2026-05-28T00:00:00Z',
  nextRun: '2026-05-28T01:00:00Z',
  lastDuration: 1_500_000_000, // 1.5s in ns
  runCount: 1234,
  errorCount: 2,
  lastError: 'transient db error',
  enabled: true,
};
const runs = [
  { startedAt: '2026-05-28T00:00:00Z', durationMs: 1500, status: 'success', replicaId: 'r-1', error: null },
  { startedAt: '2026-05-27T00:00:00Z', durationMs: 2000, status: 'failed', replicaId: null, error: 'boom' },
];

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useParams: () => ({ id: 'job-1' }),
}));
vi.mock('@/hooks/useApi', () => ({
  useApi: (_fn: unknown, key: unknown[]) =>
    key.includes('runs')
      ? { data: { runs, total: 2, limit: 25, offset: 0 }, loading: false, error: null, refetch: vi.fn() }
      : { data: job, loading: false, error: null, refetch: vi.fn() },
}));
vi.mock('@/hooks/useMutation', () => ({
  useMutation: () => ({
    mutate: (arg: unknown) => { mutateCalls.push(arg); return Promise.resolve(); },
    loading: false,
  }),
}));

function wrap() {
  return render(
    <I18nextProvider i18n={i18n}><MemoryRouter><InfraJobDetailPage /></MemoryRouter></I18nextProvider>,
  );
}

describe('InfraJobDetailPage', () => {
  beforeEach(() => { mutateCalls.length = 0; });

  it('renders the job info grid with formatted interval/duration + run count', () => {
    wrap();
    // name appears in the breadcrumb + header + info grid
    expect(screen.getAllByText('cost-rollup').length).toBeGreaterThan(0);
    expect(screen.getByText('1h')).toBeInTheDocument(); // formatNsDuration(1h interval)
    expect(screen.getByText('1,234')).toBeInTheDocument(); // runCount.toLocaleString()
    expect(screen.getByText('transient db error')).toBeInTheDocument(); // lastError row
  });

  it('renders the run-history rows with their status badges', () => {
    wrap();
    expect(screen.getByText('boom')).toBeInTheDocument(); // failed run error cell
    expect(screen.getByText('r-1')).toBeInTheDocument(); // replicaId of the success run
  });

  it('Trigger fires the trigger mutation with the job id', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: /trigger/i }));
    await waitFor(() => expect(mutateCalls).toContain('job-1'));
  });

  it('Disable toggles enabled=false for an enabled job', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: /disable/i }));
    await waitFor(() =>
      expect(mutateCalls).toContainEqual({ jobId: 'job-1', enabled: false }),
    );
  });
});
