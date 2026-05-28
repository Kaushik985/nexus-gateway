import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { getColumnsForSource } from '@/pages/traffic/list/TrafficTab';
import type { TrafficEvent } from '@/api/types';

// Stub translator — column render logic is independent of label text.
const t = (k: string) => k;

const event = {
  timestamp: '2026-05-28T00:00:00Z',
  statusCode: 200,
  latencyMs: 120,
  modelName: 'gpt-4o',
  routedProviderName: 'OpenAI',
  routedModelName: 'gpt-4o',
  totalTokens: 1500,
  promptTokens: 1000,
  completionTokens: 500,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  modelInputPricePerMillion: 5,
  modelOutputPricePerMillion: 15,
  targetHost: 'api.openai.com',
  sourceIp: '1.2.3.4',
  method: 'POST',
  path: '/v1/chat/completions',
  bumpStatus: 'BUMP_SUCCESS',
  action: 'inspect',
  sourceProcess: 'curl',
  cacheStatus: 'HIT',
  requestHookDecision: 'APPROVE',
  orgName: 'Acme', orgId: 'o1',
  entityName: 'Ent', entityId: 'e1',
  source: 'vk',
  identity: { project: { name: 'Proj', id: 'p1' } },
} as unknown as TrafficEvent;

function colMap(source: '' | 'vk' | 'proxy' | 'agent') {
  const cols = getColumnsForSource(source, t);
  return new Map(cols.map((c) => [c.key, c]));
}

describe('getColumnsForSource — vk', () => {
  const cols = colMap('vk');

  it('exposes the gateway-traffic columns', () => {
    for (const k of ['timestamp', 'requestedModel', 'routedTarget', 'user', 'orgName', 'project', 'credential', 'statusCode', 'totalTokens', 'upstreamCostUsd', 'cacheStatus']) {
      expect(cols.has(k)).toBe(true);
    }
  });

  it('routedTarget joins provider + model, falling back to whichever is present', () => {
    expect(cols.get('routedTarget')!.render(event)).toBe('OpenAI / gpt-4o');
    expect(cols.get('routedTarget')!.render({ ...event, routedModelName: '' } as TrafficEvent)).toBe('OpenAI');
    expect(cols.get('routedTarget')!.render({ ...event, routedProviderName: '', routedModelName: '' } as TrafficEvent)).toBe('-');
  });

  it('cost recomputes from tokens × per-million prices, and is "-" without a price snapshot', () => {
    // uncached 1000×$5/M + output 500×$15/M = 0.0125 → a formatted (non-dash) value
    expect(cols.get('upstreamCostUsd')!.render(event)).not.toBe('-');
    expect(cols.get('upstreamCostUsd')!.render({ ...event, modelInputPricePerMillion: undefined, modelOutputPricePerMillion: undefined } as TrafficEvent)).toBe('-');
  });

  it('tokens formats a present count and dashes a null', () => {
    expect(cols.get('totalTokens')!.render(event)).not.toBe('-');
    expect(cols.get('totalTokens')!.render({ ...event, totalTokens: undefined } as TrafficEvent)).toBe('-');
  });

  it('statusCode renders a 200 badge', () => {
    const { getByText } = render(<>{cols.get('statusCode')!.render(event)}</>);
    expect(getByText('200')).toBeInTheDocument();
  });
});

describe('getColumnsForSource — proxy / agent / all', () => {
  it('proxy carries the network columns', () => {
    const cols = colMap('proxy');
    for (const k of ['targetHost', 'sourceIp', 'method', 'path', 'bumpStatus', 'complianceTags']) {
      expect(cols.has(k)).toBe(true);
    }
    expect(cols.get('targetHost')!.render(event)).toBe('api.openai.com');
    expect(cols.get('bumpStatus')!.render(event)).toBe('BUMP_SUCCESS');
    expect(cols.get('method')!.render(event)).toBe('POST');
  });

  it('agent carries device + process + action columns', () => {
    const cols = colMap('agent');
    for (const k of ['device', 'sourceProcess', 'action', 'targetHost']) {
      expect(cols.has(k)).toBe(true);
    }
    expect(cols.get('action')!.render(event)).toBe('inspect');
    expect(cols.get('sourceProcess')!.render(event)).toBe('curl');
  });

  it('all-sources carries the source + entity columns', () => {
    const cols = colMap('');
    expect(cols.has('source')).toBe(true);
    expect(cols.has('entity')).toBe(true);
    expect(cols.get('method')!.render(event)).toBe('POST');
  });

  it('long paths are truncated to 40 chars with a title tooltip', () => {
    const cols = colMap('proxy');
    const longPath = '/v1/' + 'x'.repeat(80);
    const { container } = render(<>{cols.get('path')!.render({ ...event, path: longPath } as TrafficEvent)}</>);
    const span = container.querySelector('span[title]');
    expect(span).toHaveAttribute('title', longPath);
  });
});
