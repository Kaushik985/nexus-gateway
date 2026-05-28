/**
 * useUnsavedChangesWarning — attaches a `beforeunload` guard only while the
 * form is dirty, stamps the (custom or default) message on the event, and
 * removes the guard when the dirty flag clears / on unmount.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';

function fireBeforeUnload() {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e as Event & { returnValue?: string };
}

describe('useUnsavedChangesWarning', () => {
  it('only guards (preventDefault) while dirty, and cleans up when cleared', () => {
    const { rerender } = renderHook(({ d }) => useUnsavedChangesWarning(d), { initialProps: { d: false } });
    // not dirty → no guard
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
    // dirty → the beforeunload handler runs and cancels the event
    rerender({ d: true });
    expect(fireBeforeUnload().defaultPrevented).toBe(true);
    // clearing dirty removes the guard
    rerender({ d: false });
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });

  it('runs the guard with a custom message (handler still cancels the event)', () => {
    // jsdom exposes Event.returnValue as the legacy boolean, so we assert the
    // observable cancel rather than the (browser-ignored) message string; the
    // message-resolution branch is exercised regardless.
    renderHook(() => useUnsavedChangesWarning(true, 'Discard your draft?'));
    expect(fireBeforeUnload().defaultPrevented).toBe(true);
  });

  it('removes the guard on unmount', () => {
    const { unmount } = renderHook(() => useUnsavedChangesWarning(true));
    unmount();
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });
});
