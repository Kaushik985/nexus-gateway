import { describe, it, expect } from 'vitest';
import { REQUIRED_THEME_TOKENS } from '../../src/theme/completeness';

// The theme-completeness contract: the tokens every theme pack MUST define so
// a branded screen never silently falls back to the default palette. This
// pins the contract's integrity (the CI checker depends on it).
describe('REQUIRED_THEME_TOKENS', () => {
  it('includes the brand-defining tokens', () => {
    for (const t of ['color-primary', 'color-bg', 'color-surface', 'color-text', 'sidebar-bg']) {
      expect(REQUIRED_THEME_TOKENS).toContain(t);
    }
  });

  it('has no duplicate entries', () => {
    expect(new Set(REQUIRED_THEME_TOKENS).size).toBe(REQUIRED_THEME_TOKENS.length);
  });

  it('is a non-empty list of kebab-case token names', () => {
    expect(REQUIRED_THEME_TOKENS.length).toBeGreaterThan(20);
    for (const t of REQUIRED_THEME_TOKENS) {
      expect(t).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
});
