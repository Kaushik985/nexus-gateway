import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopLoader } from '../../../../src/components/ui/TopLoader/TopLoader';

// Thin navigation progress bar shown inside <Suspense>. It seeds width to 10%
// synchronously on mount, then ramps via rAF.
describe('TopLoader', () => {
  it('renders a progressbar seeded at ~10% on mount', () => {
    render(<TopLoader />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toBeInTheDocument();
    expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(10);
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
  });

  it('does not throw on unmount (completes to 100%)', () => {
    const { unmount } = render(<TopLoader />);
    expect(() => unmount()).not.toThrow();
  });
});
