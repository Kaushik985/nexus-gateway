/**
 * useIdleTimeout — fires onWarning at warningMs and onTimeout at timeoutMs of
 * inactivity, resets both (and fires onActivity) on a user-activity event, and
 * is a no-op (registers no timers) while disabled.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIdleTimeout } from '@/auth/context/useIdleTimeout';

const opts = (over: Partial<Parameters<typeof useIdleTimeout>[0]> = {}) => ({
  timeoutMs: 1000, warningMs: 600,
  onWarning: vi.fn(), onTimeout: vi.fn(), onActivity: vi.fn(), enabled: true,
  ...over,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useIdleTimeout', () => {
  it('fires onWarning then onTimeout as inactivity elapses', () => {
    const o = opts();
    renderHook(() => useIdleTimeout(o));
    act(() => { vi.advanceTimersByTime(600); });
    expect(o.onWarning).toHaveBeenCalledTimes(1);
    expect(o.onTimeout).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(400); });
    expect(o.onTimeout).toHaveBeenCalledTimes(1);
  });

  it('a user-activity event resets the timers and fires onActivity', () => {
    const o = opts();
    renderHook(() => useIdleTimeout(o));
    act(() => { vi.advanceTimersByTime(500); });            // just shy of warning
    act(() => { document.dispatchEvent(new Event('keydown')); }); // activity → reset
    expect(o.onActivity).toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(500); });            // 500ms since reset < 600 warning
    expect(o.onWarning).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(100); });            // now 600ms since reset
    expect(o.onWarning).toHaveBeenCalledTimes(1);
  });

  it('registers no timers while disabled', () => {
    const o = opts({ enabled: false });
    renderHook(() => useIdleTimeout(o));
    act(() => { vi.advanceTimersByTime(2000); });
    expect(o.onWarning).not.toHaveBeenCalled();
    expect(o.onTimeout).not.toHaveBeenCalled();
  });
});
