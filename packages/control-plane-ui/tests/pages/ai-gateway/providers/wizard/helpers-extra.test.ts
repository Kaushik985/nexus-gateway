import { describe, it, expect } from 'vitest';
import { featuredTemplatesFirst, templateAccent } from '../../../../../src/pages/ai-gateway/providers/wizard/helpers';
import type { ApiProviderTemplate } from '../../../../../src/pages/ai-gateway/providers/wizard/types';

const tpl = (name: string): ApiProviderTemplate => ({ name } as ApiProviderTemplate);

describe('featuredTemplatesFirst', () => {
  it('returns featured templates in the canonical order, dropping absent ones', () => {
    const all = [tpl('deepseek'), tpl('anthropic'), tpl('openai'), tpl('not-featured')];
    const out = featuredTemplatesFirst(all).map((t) => t.name);
    // openai precedes anthropic precedes deepseek per FEATURED order; non-featured dropped.
    expect(out).toEqual(['openai', 'anthropic', 'deepseek']);
  });
  it('returns an empty list when none of the templates are featured', () => {
    expect(featuredTemplatesFirst([tpl('custom-x')])).toEqual([]);
  });
});

describe('templateAccent', () => {
  it('maps known provider names to their brand accent', () => {
    expect(templateAccent('openai')).toBe('#10a37f');
    expect(templateAccent('anthropic')).toBe('#d97757');
    expect(templateAccent('xai')).toBe('#000000');
  });
  it('falls back to the primary token for unknown names', () => {
    expect(templateAccent('mystery')).toBe('var(--color-primary)');
  });
});
