import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Transition } from '../../../../src/components/ui/Transition/Transition';

afterEach(() => vi.restoreAllMocks());

function setReducedMotion(reduce: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
    matches: reduce,
    media: q,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}

describe('Transition', () => {
  it('renders children with the enter class when show=true', () => {
    render(<Transition show enter="anim-fade-in"><div>body</div></Transition>);
    const child = screen.getByText('body').parentElement!;
    expect(child.className).toContain('anim-fade-in');
  });

  it('stays unmounted when show=false from the start', () => {
    render(<Transition show={false}><div>hidden</div></Transition>);
    expect(screen.queryByText('hidden')).toBeNull();
  });

  it('applies the exit class when show flips to false (animated, non-reduced)', () => {
    setReducedMotion(false);
    const { rerender } = render(<Transition show enter="in" exit="out"><div>x</div></Transition>);
    expect(screen.getByText('x')).toBeInTheDocument();
    rerender(<Transition show={false} enter="in" exit="out"><div>x</div></Transition>);
    const wrapper = screen.getByText('x').parentElement!;
    expect(wrapper.className).toContain('out');
  });

  it('unmounts immediately when the user prefers reduced motion', () => {
    setReducedMotion(true);
    const { rerender } = render(<Transition show enter="in" exit="out"><div>y</div></Transition>);
    expect(screen.getByText('y')).toBeInTheDocument();
    rerender(<Transition show={false} enter="in" exit="out"><div>y</div></Transition>);
    expect(screen.queryByText('y')).toBeNull();
  });
});
