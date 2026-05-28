import { describe, it, expect } from 'vitest';
import {
  EMPTY_LIVE_TRAFFIC_FILTERS,
  describeLiveTrafficFilters,
  countLiveTrafficFilters,
  type LiveTrafficFiltersState,
} from '../../../../src/pages/traffic/filters/liveTrafficFilters';

const full: LiveTrafficFiltersState = {
  ...EMPTY_LIVE_TRAFFIC_FILTERS,
  provider: 'openai',
  virtualKeyId: 'vk-12345678abc',
  _vkLabel: 'my-key',
  orgId: 'org-12345678abc',
  projectId: 'proj-12345678abc',
  modelUsed: 'gpt-4o',
  requestId: 'req-1',
  requestHookDecision: 'approve',
  responseHookDecision: 'redact',
  statusCode: '404',
  cacheStatus: 'HIT',
  targetHost: 'api.openai.com',
  path: '/v1/chat',
  deviceId: 'dev-12345678abc',
  thingId: 'thing-1',
  sourceProcess: 'curl',
  bumpStatus: 'BUMP_SUCCESS',
  complianceTags: ['pii', ''],
};

describe('describeLiveTrafficFilters', () => {
  it('returns no chips for the empty state', () => {
    expect(describeLiveTrafficFilters(EMPTY_LIVE_TRAFFIC_FILTERS)).toEqual([]);
    expect(countLiveTrafficFilters(EMPTY_LIVE_TRAFFIC_FILTERS)).toBe(0);
  });

  it('builds a chip per active filter (label preferred over id slice)', () => {
    const chips = describeLiveTrafficFilters(full);
    const joined = chips.join('\n');
    expect(joined).toMatch(/openai/);
    expect(joined).toMatch(/Virtual key: my-key/); // label wins over id
    expect(joined).toMatch(/gpt-4o/);
    expect(joined).toMatch(/HTTP 404/); // valid status code
    expect(joined).toMatch(/Cache: HIT/);
    expect(joined).toMatch(/Process: curl/);
    expect(joined).toMatch(/pii/); // non-empty compliance tag only
    // The empty compliance tag is skipped.
    expect(chips.filter((c) => c.endsWith(': ')).length).toBe(0);
    expect(countLiveTrafficFilters(full)).toBe(chips.length);
  });

  it('falls back to an id slice when no label is present', () => {
    const chips = describeLiveTrafficFilters({
      ...EMPTY_LIVE_TRAFFIC_FILTERS,
      userId: 'user-9999aaaa',
    });
    expect(chips.join()).toMatch(/User: user-999…/);
  });

  it('uses the status range label when no explicit code is set', () => {
    const chips = describeLiveTrafficFilters({ ...EMPTY_LIVE_TRAFFIC_FILTERS, statusRange: '5xx' });
    expect(chips.join()).toMatch(/HTTP:/);
  });

  it('renders start/end time chips', () => {
    const chips = describeLiveTrafficFilters({
      ...EMPTY_LIVE_TRAFFIC_FILTERS,
      startTime: '2026-01-01T00:00:00Z',
      endTime: '2026-01-02T00:00:00Z',
    });
    expect(chips.length).toBe(2);
  });
});
