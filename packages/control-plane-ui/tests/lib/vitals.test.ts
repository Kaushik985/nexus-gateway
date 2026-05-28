import { describe, it, expect, vi, afterEach } from 'vitest';

// web-vitals is mocked so we can assert reportWebVitals wires every Core Web
// Vital callback, and that the reporter logs (dev) without throwing.
const onCLS = vi.fn();
const onFCP = vi.fn();
const onLCP = vi.fn();
const onTTFB = vi.fn();
vi.mock('web-vitals', () => ({
  onCLS: (cb: unknown) => onCLS(cb),
  onFCP: (cb: unknown) => onFCP(cb),
  onLCP: (cb: unknown) => onLCP(cb),
  onTTFB: (cb: unknown) => onTTFB(cb),
}));

describe('reportWebVitals', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('registers a reporter for each Core Web Vital', async () => {
    const { reportWebVitals } = await import('../../src/lib/vitals');
    reportWebVitals();
    expect(onCLS).toHaveBeenCalledTimes(1);
    expect(onFCP).toHaveBeenCalledTimes(1);
    expect(onLCP).toHaveBeenCalledTimes(1);
    expect(onTTFB).toHaveBeenCalledTimes(1);
  });

  it('the registered reporter logs the metric in non-production', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { reportWebVitals } = await import('../../src/lib/vitals');
    reportWebVitals();
    // Drive the callback the module handed to onLCP, as web-vitals would.
    const reporter = onLCP.mock.calls[0][0] as (m: unknown) => void;
    reporter({ name: 'LCP', value: 1234.56, rating: 'good' });
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy.mock.calls[0][0]).toContain('LCP');
    expect(debugSpy.mock.calls[0][0]).toContain('good');
  });
});
