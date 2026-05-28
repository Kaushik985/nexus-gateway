import { describe, it, expect } from 'vitest';
import { cn } from '../../src/lib/cn';

// cn merges class names via clsx + tailwind-merge — the shared classname
// helper for ui-shared's shadcn-style components.
describe('cn', () => {
  it('joins multiple class arguments', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('drops falsy / conditional entries', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
    expect(cn('base', { active: true, disabled: false })).toBe('base active');
  });

  it('lets a later Tailwind utility win over an earlier conflicting one', () => {
    // tailwind-merge resolves p-2 vs p-4 to the last one.
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm text-red-500', 'text-lg')).toBe('text-red-500 text-lg');
  });
});
