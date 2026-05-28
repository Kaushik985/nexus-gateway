import { describe, it, expect } from 'vitest';
import { classify, isAITraffic, statusDescriptor } from '../../src/lib/classify';
import type { AgentEvent } from '@/api/agent';

// Mirror of the Go-side audit.Classify decision tree. Build minimal events;
// only the classification-relevant fields matter.
function ev(p: Partial<AgentEvent>): AgentEvent {
  return p as AgentEvent;
}

describe('classify', () => {
  it('untracked when domainRuleId is empty and action is not a matched verb', () => {
    expect(classify(ev({ domainRuleId: '' }))).toBe('untracked');
    expect(classify(ev({}))).toBe('untracked');
    expect(classify(ev({ domainRuleId: '', action: 'relay' }))).toBe('untracked');
  });

  it('legacy rows without domainRuleId fall through on action inspect/deny', () => {
    // action=inspect → falls through to the inspect fallthrough.
    expect(classify(ev({ domainRuleId: '', action: 'inspect' }))).toBe('inspect');
    // action=deny → the action=="deny" branch → blocked.
    expect(classify(ev({ domainRuleId: '', action: 'deny' }))).toBe('blocked');
  });

  it('bump failures take priority over hook decisions', () => {
    for (const s of ['BUMP_FAILED', 'BUMP_FAILED_PASSTHROUGH', 'BUMP_FAILED_MINT_FALLBACK_RELAY']) {
      expect(classify(ev({ domainRuleId: 'd1', bumpStatus: s, hookDecision: 'approve' }))).toBe(
        'bump_failed',
      );
    }
  });

  it('maps hook decisions (case-insensitive) to blocked/processed', () => {
    expect(classify(ev({ domainRuleId: 'd1', hookDecision: 'reject_hard' }))).toBe('blocked');
    expect(classify(ev({ domainRuleId: 'd1', hookDecision: 'block_soft' }))).toBe('blocked');
    expect(classify(ev({ domainRuleId: 'd1', hookDecision: 'DENY' }))).toBe('blocked');
    expect(classify(ev({ domainRuleId: 'd1', hookDecision: 'APPROVE' }))).toBe('processed');
  });

  it('action=deny without a hook decision is blocked', () => {
    expect(classify(ev({ domainRuleId: 'd1', action: 'deny' }))).toBe('blocked');
  });

  it('falls through to inspect for a matched host with no hook output', () => {
    expect(classify(ev({ domainRuleId: 'd1', hookDecision: '', action: 'inspect' }))).toBe('inspect');
    expect(classify(ev({ domainRuleId: 'd1' }))).toBe('inspect');
  });
});

describe('isAITraffic', () => {
  it('is true when a domain rule matched', () => {
    expect(isAITraffic(ev({ domainRuleId: 'd1' }))).toBe(true);
  });
  it('falls back to action=inspect for legacy rows', () => {
    expect(isAITraffic(ev({ domainRuleId: '', action: 'inspect' }))).toBe(true);
    expect(isAITraffic(ev({ domainRuleId: '', action: 'relay' }))).toBe(false);
  });
});

describe('statusDescriptor', () => {
  it('maps every classification to a label + tone', () => {
    expect(statusDescriptor(ev({ domainRuleId: '' }))).toMatchObject({ label: 'Untracked', tone: 'muted' });
    expect(statusDescriptor(ev({ domainRuleId: 'd1' }))).toMatchObject({ label: 'Inspected', tone: 'good' });
    expect(statusDescriptor(ev({ domainRuleId: 'd1', hookDecision: 'approve' }))).toMatchObject({
      label: 'Processed',
      tone: 'warn',
    });
    expect(statusDescriptor(ev({ domainRuleId: 'd1', hookDecision: 'deny' }))).toMatchObject({
      label: 'Blocked',
      tone: 'bad',
    });
    expect(statusDescriptor(ev({ domainRuleId: 'd1', bumpStatus: 'BUMP_FAILED' }))).toMatchObject({
      label: 'Bump failed',
      tone: 'bad',
    });
  });
});
