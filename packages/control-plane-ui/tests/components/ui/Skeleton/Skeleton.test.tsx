import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton } from '../../../../src/components/ui/Skeleton/Skeleton';

// Shimmer placeholders. Pure presentational — assert each variant renders the
// expected element count / structure without throwing.
describe('Skeleton', () => {
  it('renders Card with the requested number of lines (+ heading)', () => {
    const { container } = render(<Skeleton.Card lines={4} />);
    // 4 lines + 1 heading div inside the card.
    expect(container.querySelectorAll('div').length).toBeGreaterThanOrEqual(5);
  });
  it('renders MetricsRow with `count` cards', () => {
    const { container } = render(<Skeleton.MetricsRow count={3} />);
    // each card has 3 children; assert at least 3 card wrappers exist
    expect(container.querySelectorAll('div').length).toBeGreaterThanOrEqual(3 * 3);
  });
  it('renders Table with header + rows*cols cells', () => {
    const { container } = render(<Skeleton.Table rows={2} cols={3} />);
    // header row (3) + 2 rows * 3 = 9 cell-ish divs minimum
    expect(container.querySelectorAll('div').length).toBeGreaterThanOrEqual(9);
  });
  it('renders the primitive variants + page skeletons without throwing', () => {
    expect(() => render(<Skeleton.Line width="50%" />)).not.toThrow();
    expect(() => render(<Skeleton.Heading width={100} />)).not.toThrow();
    expect(() => render(<Skeleton.Box width={200} height={40} />)).not.toThrow();
    expect(() => render(<Skeleton.Circle size={24} />)).not.toThrow();
    expect(() => render(<Skeleton.DashboardSkeleton />)).not.toThrow();
    expect(() => render(<Skeleton.ListPageSkeleton />)).not.toThrow();
    expect(() => render(<Skeleton.DetailPageSkeleton />)).not.toThrow();
  });
});
