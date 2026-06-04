import { describe, it, expect } from 'vitest';
import { viewToRoute, KNOWN_VIEWS } from './viewRoutes';

describe('viewToRoute', () => {
  it('maps known cockpit views to CP-UI routes', () => {
    expect(viewToRoute('overview')).toBe('/');
    expect(viewToRoute('radar')).toBe('/traffic');
    expect(viewToRoute('cost')).toBe('/analytics');
    expect(viewToRoute('nodes')).toBe('/infrastructure/nodes');
    expect(viewToRoute('kill')).toBe('/infrastructure/kill-switch');
    expect(viewToRoute('keys')).toBe('/ai-gateway/virtual-keys');
    expect(viewToRoute('rules')).toBe('/ai-gateway/routing');
  });

  it('appends a traffic filter as query params', () => {
    expect(viewToRoute('radar', { status: '5xx', model: 'gpt-4o' })).toBe('/traffic?status=5xx&model=gpt-4o');
  });

  it('routes a single event to Traffic with its id', () => {
    expect(viewToRoute('event', { eventId: 'evt-1' })).toBe('/traffic?eventId=evt-1');
    expect(viewToRoute('event')).toBe('/traffic');
  });

  it('returns null for an unknown view so the widget does not navigate', () => {
    expect(viewToRoute('bogus')).toBeNull();
    expect(viewToRoute('')).toBeNull();
  });

  it('every known view resolves to a route (map stays complete)', () => {
    for (const v of KNOWN_VIEWS) {
      expect(viewToRoute(v, { eventId: 'x' })).not.toBeNull();
    }
  });

  // Drift guard: mirror the kernel's canvas tool enum (nexus-agent-core
  // capabilities/runtime/canvas.go navigate schema). If the kernel gains a view,
  // this list must be updated AND VIEW_ROUTES extended — otherwise a directive the
  // backend can emit would silently fail to navigate. This is the real AC-2 check
  // (the KNOWN_VIEWS loop above is self-referential and cannot catch kernel drift).
  it('covers every view the kernel canvas tool can emit', () => {
    const kernelEmittableViews = [
      'overview', 'radar', 'cost', 'slo', 'nodes', 'alerts', 'compliance',
      'jobs', 'sync', 'models', 'keys', 'rules', 'kill', 'event',
    ];
    for (const v of kernelEmittableViews) {
      expect(viewToRoute(v, { eventId: 'x' })).not.toBeNull();
    }
  });
});
