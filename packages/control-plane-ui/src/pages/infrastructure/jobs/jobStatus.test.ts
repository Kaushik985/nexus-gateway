import { describe, it, expect } from 'vitest';
import { jobStatusVariant } from './jobStatus';

describe('jobStatusVariant', () => {
  it('maps job-level lastStatus values', () => {
    expect(jobStatusVariant('ok')).toBe('success');
    expect(jobStatusVariant('success')).toBe('success');
    expect(jobStatusVariant('running')).toBe('warning');
    expect(jobStatusVariant('failed')).toBe('danger');
    expect(jobStatusVariant('error')).toBe('danger');
    expect(jobStatusVariant('interrupted')).toBe('default');
  });

  it('maps per-run status values, including the ones each page previously missed', () => {
    // Regression guard: the list page mapped `interrupted` but not `skipped`,
    // the detail page mapped `skipped` but not `interrupted`. The shared helper
    // covers both so a status renders the same color on either page.
    expect(jobStatusVariant('skipped')).toBe('default');
    expect(jobStatusVariant('interrupted')).toBe('default');
  });

  it('is case-insensitive', () => {
    expect(jobStatusVariant('RUNNING')).toBe('warning');
    expect(jobStatusVariant('Failed')).toBe('danger');
  });

  it('falls back to the generic status mapping for null/unknown', () => {
    expect(jobStatusVariant(null)).toBe('default');
    expect(jobStatusVariant(undefined)).toBe('default');
    expect(jobStatusVariant('')).toBe('default');
  });
});
