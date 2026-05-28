import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { MiniLineChart } from '@/pages/activity/MiniLineChart';
describe('MiniLineChart', () => {
  it('shows a no-data message for an empty series', () => {
    const { container } = render(<MiniLineChart data={[]} />);
    expect(container.textContent).toMatch(/No data/i);
  });
  it('renders an SVG path for a multi-point series', () => {
    const { container } = render(<MiniLineChart data={[{ bucket: 't0', value: 1 }, { bucket: 't1', value: 5 }, { bucket: 't2', value: 3 }]} ariaLabel="trend" />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.querySelector('path')).toBeTruthy();
  });
  it('handles a single-point series without dividing by zero', () => {
    const { container } = render(<MiniLineChart data={[{ bucket: 't0', value: 7 }]} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
