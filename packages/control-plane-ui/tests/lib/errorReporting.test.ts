import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildClientErrorReportBody } from '../../src/lib/errorReporting';

describe('buildClientErrorReportBody', () => {
  it('includes service, kind, message, and stack', () => {
    const err = new Error('test failure');
    err.stack = 'Error: test failure\n  at foo.ts:1:1';
    const body = buildClientErrorReportBody({ kind: 'react', error: err, componentStack: 'in Foo' });
    expect(body.service).toBe('nexus-dashboard');
    expect(body.kind).toBe('react');
    expect(body.message).toBe('test failure');
    expect(body.stack).toContain('test failure');
    expect(body.componentStack).toBe('in Foo');
    expect(typeof body.ts).toBe('string');
  });

  it('truncates long stacks', () => {
    const err = new Error('x');
    err.stack = 'a'.repeat(20_000);
    const body = buildClientErrorReportBody({ kind: 'window', error: err });
    expect(String(body.stack).length).toBeLessThan(20_000);
    expect(String(body.stack)).toContain('[truncated]');
  });
});

describe('reportClientError (integration)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('uses sendBeacon when URL is configured', async () => {
    vi.stubEnv('VITE_CLIENT_ERROR_REPORTING_URL', 'https://example.com/client-errors');
    const beacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: beacon,
    });
    vi.resetModules();
    const { reportClientError } = await import('../../src/lib/errorReporting');
    reportClientError({ kind: 'react', error: new Error('boom') });
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, data] = beacon.mock.calls[0] as [string, Blob];
    expect(url).toBe('https://example.com/client-errors');
    expect(data).toBeInstanceOf(Blob);
    const text = await data.text();
    const parsed = JSON.parse(text) as { message: string; kind: string };
    expect(parsed.message).toBe('boom');
    expect(parsed.kind).toBe('react');
  });

  it('falls back to fetch when sendBeacon returns false', async () => {
    vi.stubEnv('VITE_CLIENT_ERROR_REPORTING_URL', 'https://example.com/client-errors');
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue(false),
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());
    vi.resetModules();
    const { reportClientError } = await import('../../src/lib/errorReporting');
    reportClientError({ kind: 'unhandledrejection', error: new Error('rej') });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/client-errors',
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        keepalive: true,
      }),
    );
  });

  it('falls through to fetch when sendBeacon throws', async () => {
    vi.stubEnv('VITE_CLIENT_ERROR_REPORTING_URL', 'https://example.com/client-errors');
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: vi.fn(() => {
        throw new Error('beacon blocked');
      }),
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());
    vi.resetModules();
    const { reportClientError } = await import('../../src/lib/errorReporting');
    reportClientError({ kind: 'window', error: new Error('x') });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('swallows a throwing fetch — reporting must never throw', async () => {
    vi.stubEnv('VITE_CLIENT_ERROR_REPORTING_URL', 'https://example.com/client-errors');
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue(false),
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('network down');
    });
    vi.resetModules();
    const { reportClientError } = await import('../../src/lib/errorReporting');
    expect(() => reportClientError({ kind: 'react', error: new Error('x') })).not.toThrow();
  });

  it('is a no-op when no reporting URL is configured', async () => {
    vi.stubEnv('VITE_CLIENT_ERROR_REPORTING_URL', '');
    const beacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: beacon,
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());
    vi.resetModules();
    const { reportClientError } = await import('../../src/lib/errorReporting');
    reportClientError({ kind: 'react', error: new Error('x') });
    expect(beacon).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('reportReactError', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reports with kind=react and the component stack from ErrorInfo', async () => {
    vi.stubEnv('VITE_CLIENT_ERROR_REPORTING_URL', 'https://example.com/client-errors');
    const beacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: beacon,
    });
    vi.resetModules();
    const { reportReactError } = await import('../../src/lib/errorReporting');
    reportReactError(new Error('render boom'), { componentStack: '\n  in Widget' } as never);
    expect(beacon).toHaveBeenCalledTimes(1);
    const [, data] = beacon.mock.calls[0] as [string, Blob];
    const parsed = JSON.parse(await data.text()) as { kind: string; componentStack: string };
    expect(parsed.kind).toBe('react');
    expect(parsed.componentStack).toContain('in Widget');
  });
});

describe('initGlobalErrorReporting', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    delete (window as Window & { __nexusGlobalErrorReporting?: boolean }).__nexusGlobalErrorReporting;
  });

  it('is a no-op when no reporting URL is configured', async () => {
    vi.stubEnv('VITE_CLIENT_ERROR_REPORTING_URL', '');
    const addSpy = vi.spyOn(window, 'addEventListener');
    vi.resetModules();
    const { initGlobalErrorReporting } = await import('../../src/lib/errorReporting');
    initGlobalErrorReporting();
    expect(addSpy).not.toHaveBeenCalled();
  });

  it('registers error + unhandledrejection listeners once (idempotent)', async () => {
    vi.stubEnv('VITE_CLIENT_ERROR_REPORTING_URL', 'https://example.com/client-errors');
    const addSpy = vi.spyOn(window, 'addEventListener');
    vi.resetModules();
    const { initGlobalErrorReporting } = await import('../../src/lib/errorReporting');
    initGlobalErrorReporting();
    initGlobalErrorReporting(); // second call must be a guarded no-op
    const events = addSpy.mock.calls.map((c) => c[0]);
    expect(events.filter((e) => e === 'error')).toHaveLength(1);
    expect(events.filter((e) => e === 'unhandledrejection')).toHaveLength(1);
  });

  it('reports a window error event with filename/line/col', async () => {
    vi.stubEnv('VITE_CLIENT_ERROR_REPORTING_URL', 'https://example.com/client-errors');
    const beacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: beacon,
    });
    vi.resetModules();
    const { initGlobalErrorReporting } = await import('../../src/lib/errorReporting');
    initGlobalErrorReporting();
    const evt = new ErrorEvent('error', {
      error: new Error('window boom'),
      filename: 'app.js',
      lineno: 42,
      colno: 7,
    });
    window.dispatchEvent(evt);
    // jsdom's window persists across tests, so anonymous listeners registered
    // by earlier inits also fire — all with an identical payload. Assert it was
    // reported and inspect the payload; the idempotency test pins once-only
    // registration via the addEventListener spy.
    expect(beacon).toHaveBeenCalled();
    const parsed = JSON.parse(await (beacon.mock.calls[0][1] as Blob).text()) as {
      kind: string;
      filename: string;
      lineno: number;
    };
    expect(parsed.kind).toBe('window');
    expect(parsed.filename).toBe('app.js');
    expect(parsed.lineno).toBe(42);
  });

  it('synthesizes an Error when the error event carries only a message', async () => {
    vi.stubEnv('VITE_CLIENT_ERROR_REPORTING_URL', 'https://example.com/client-errors');
    const beacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: beacon,
    });
    vi.resetModules();
    const { initGlobalErrorReporting } = await import('../../src/lib/errorReporting');
    initGlobalErrorReporting();
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error' }));
    const parsed = JSON.parse(await (beacon.mock.calls[0][1] as Blob).text()) as { message: string };
    expect(parsed.message).toBe('Script error');
  });

  it('reports an unhandledrejection with an Error reason', async () => {
    vi.stubEnv('VITE_CLIENT_ERROR_REPORTING_URL', 'https://example.com/client-errors');
    const beacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: beacon,
    });
    vi.resetModules();
    const { initGlobalErrorReporting } = await import('../../src/lib/errorReporting');
    initGlobalErrorReporting();
    // jsdom lacks a PromiseRejectionEvent ctor; an Event carrying `reason` is enough.
    const evt = new Event('unhandledrejection') as Event & { reason?: unknown };
    evt.reason = new Error('promise boom');
    window.dispatchEvent(evt);
    expect(beacon).toHaveBeenCalled();
    const parsed = JSON.parse(await (beacon.mock.calls[0][1] as Blob).text()) as {
      kind: string;
      message: string;
    };
    expect(parsed.kind).toBe('unhandledrejection');
    expect(parsed.message).toBe('promise boom');
  });

  it('synthesizes an Error from a string rejection reason', async () => {
    vi.stubEnv('VITE_CLIENT_ERROR_REPORTING_URL', 'https://example.com/client-errors');
    const beacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: beacon,
    });
    vi.resetModules();
    const { initGlobalErrorReporting } = await import('../../src/lib/errorReporting');
    initGlobalErrorReporting();
    const evt = new Event('unhandledrejection') as Event & { reason?: unknown };
    evt.reason = 'plain string reason';
    window.dispatchEvent(evt);
    const parsed = JSON.parse(await (beacon.mock.calls[0][1] as Blob).text()) as { message: string };
    expect(parsed.message).toBe('plain string reason');
  });

  it('falls back to a generic message for a non-Error, non-string rejection reason', async () => {
    vi.stubEnv('VITE_CLIENT_ERROR_REPORTING_URL', 'https://example.com/client-errors');
    const beacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(globalThis.navigator, 'sendBeacon', { configurable: true, writable: true, value: beacon });
    vi.resetModules();
    const { initGlobalErrorReporting } = await import('../../src/lib/errorReporting');
    initGlobalErrorReporting();
    const evt = new Event('unhandledrejection') as Event & { reason?: unknown };
    evt.reason = { code: 500 }; // neither Error nor string
    window.dispatchEvent(evt);
    const parsed = JSON.parse(await (beacon.mock.calls[0][1] as Blob).text()) as { message: string };
    expect(parsed.message).toBe('Unhandled promise rejection');
  });
});
