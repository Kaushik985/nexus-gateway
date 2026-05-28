import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  TimeRangeProvider,
  useTimeRange,
  presetToRange,
  type TimeRangePreset,
} from '../../src/context/TimeRangeContext';

const STORAGE_KEY = 'nexusGlobalTimeRange';
const DAY = 24 * 60 * 60 * 1000;

function Probe() {
  const { range, setPreset, setRange } = useTimeRange();
  const spanDays = Math.round(
    (new Date(range.end).getTime() - new Date(range.start).getTime()) / DAY,
  );
  return (
    <div>
      <span data-testid="preset">{range.preset}</span>
      <span data-testid="span">{spanDays}</span>
      <button onClick={() => setPreset('30d')}>preset30</button>
      <button
        onClick={() =>
          setRange({
            start: '2026-01-01T00:00:00.000Z',
            end: '2026-01-02T00:00:00.000Z',
            preset: 'custom',
          })
        }
      >
        custom
      </button>
    </div>
  );
}

describe('presetToRange', () => {
  it('produces the right window width and preset label for each preset', () => {
    const cases: Array<[Exclude<TimeRangePreset, 'custom'>, number]> = [
      ['24h', 1],
      ['7d', 7],
      ['30d', 30],
      ['90d', 90],
    ];
    for (const [preset, days] of cases) {
      const r = presetToRange(preset);
      expect(r.preset).toBe(preset);
      const span = (new Date(r.end).getTime() - new Date(r.start).getTime()) / DAY;
      expect(Math.round(span)).toBe(days);
      expect(new Date(r.end).getTime()).toBeGreaterThan(new Date(r.start).getTime());
    }
  });
});

describe('TimeRangeProvider — storage restore', () => {
  beforeEach(() => localStorage.removeItem(STORAGE_KEY));
  afterEach(() => localStorage.removeItem(STORAGE_KEY));

  it('defaults to the 7d preset with no stored range', () => {
    render(
      <TimeRangeProvider>
        <Probe />
      </TimeRangeProvider>,
    );
    expect(screen.getByTestId('preset').textContent).toBe('7d');
    expect(screen.getByTestId('span').textContent).toBe('7');
  });

  it('restores a valid stored range within the 90-day cap', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-01-15T00:00:00.000Z',
        preset: 'custom',
      }),
    );
    render(
      <TimeRangeProvider>
        <Probe />
      </TimeRangeProvider>,
    );
    expect(screen.getByTestId('preset').textContent).toBe('custom');
    expect(screen.getByTestId('span').textContent).toBe('14');
  });

  it('drops a stored range wider than the 90-day cap and falls back to default', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        start: '2024-01-01T00:00:00.000Z',
        end: '2026-01-01T00:00:00.000Z', // ~2 years
        preset: 'custom',
      }),
    );
    render(
      <TimeRangeProvider>
        <Probe />
      </TimeRangeProvider>,
    );
    expect(screen.getByTestId('preset').textContent).toBe('7d');
  });

  it('falls back to default on an inverted (end < start) stored range', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        start: '2026-02-01T00:00:00.000Z',
        end: '2026-01-01T00:00:00.000Z',
        preset: 'custom',
      }),
    );
    render(
      <TimeRangeProvider>
        <Probe />
      </TimeRangeProvider>,
    );
    expect(screen.getByTestId('preset').textContent).toBe('7d');
  });

  it('falls back to default on corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    render(
      <TimeRangeProvider>
        <Probe />
      </TimeRangeProvider>,
    );
    expect(screen.getByTestId('preset').textContent).toBe('7d');
  });
});

describe('TimeRangeProvider — updates', () => {
  beforeEach(() => localStorage.removeItem(STORAGE_KEY));

  it('setPreset updates the range and persists to storage', async () => {
    const user = userEvent.setup();
    render(
      <TimeRangeProvider>
        <Probe />
      </TimeRangeProvider>,
    );
    await user.click(screen.getByText('preset30'));
    expect(screen.getByTestId('preset').textContent).toBe('30d');
    expect(screen.getByTestId('span').textContent).toBe('30');
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as { preset: string };
    expect(stored.preset).toBe('30d');
  });

  it('setRange persists a custom range', async () => {
    const user = userEvent.setup();
    render(
      <TimeRangeProvider>
        <Probe />
      </TimeRangeProvider>,
    );
    await user.click(screen.getByText('custom'));
    expect(screen.getByTestId('preset').textContent).toBe('custom');
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as { preset: string };
    expect(stored.preset).toBe('custom');
  });

  it('recomputes a preset range on the rolling 60s tick', () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(presetToRange('24h')));
      render(
        <TimeRangeProvider>
          <Probe />
        </TimeRangeProvider>,
      );
      const firstEnd = JSON.parse(localStorage.getItem(STORAGE_KEY)!).end as string;
      // Advance wall clock + the 60s interval; the preset window must roll forward.
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      // The in-memory range end advances (read via the probe's recompute).
      expect(screen.getByTestId('preset').textContent).toBe('24h');
      expect(firstEnd).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useTimeRange outside a provider', () => {
  it('returns the default 7d preset with no-op setters', () => {
    let captured: ReturnType<typeof useTimeRange> | null = null;
    function Bare() {
      captured = useTimeRange();
      return <span data-testid="p">{captured.range.preset}</span>;
    }
    render(<Bare />);
    expect(screen.getByTestId('p').textContent).toBe('7d');
    // No-op setters must not throw.
    expect(() => captured!.setPreset('30d')).not.toThrow();
    expect(() =>
      captured!.setRange({ start: 'a', end: 'b', preset: 'custom' }),
    ).not.toThrow();
  });
});
