import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShadcnButton, buttonVariants } from '../../src/shadcn/button';

// shadcn-style Button: renders a native <button> by default (or a Slot when
// asChild), stamping variant/size as data-attributes + merged classes.
describe('ShadcnButton', () => {
  it('renders a native button with default variant + size data-attrs', () => {
    render(<ShadcnButton>Click</ShadcnButton>);
    const btn = screen.getByRole('button', { name: 'Click' });
    expect(btn.getAttribute('data-slot')).toBe('button');
    expect(btn.getAttribute('data-variant')).toBe('default');
    expect(btn.getAttribute('data-size')).toBe('default');
  });

  it('reflects explicit variant + size and forwards native props', () => {
    render(
      <ShadcnButton variant="destructive" size="sm" type="submit" disabled>
        Delete
      </ShadcnButton>,
    );
    const btn = screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    expect(btn.getAttribute('data-variant')).toBe('destructive');
    expect(btn.getAttribute('data-size')).toBe('sm');
    expect(btn.type).toBe('submit');
    expect(btn.disabled).toBe(true);
  });

  it('renders its child element when asChild is set (Slot)', () => {
    render(
      <ShadcnButton asChild>
        <a href="/go">link-button</a>
      </ShadcnButton>,
    );
    const link = screen.getByRole('link', { name: 'link-button' });
    expect(link.getAttribute('href')).toBe('/go');
    expect(link.getAttribute('data-slot')).toBe('button');
  });

  it('buttonVariants produces a class string for a variant/size combo', () => {
    expect(typeof buttonVariants({ variant: 'outline', size: 'lg' })).toBe('string');
  });
});
