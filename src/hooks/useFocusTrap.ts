import { useLayoutEffect, useRef } from 'react';

const focusable = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]';

export function useFocusTrap<T extends HTMLElement>(active = true, restoreTarget?: HTMLElement | null) {
  const ref = useRef<T>(null);
  const previous = useRef(document.activeElement as HTMLElement | null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!active || !node) return;
    const restore = restoreTarget ?? previous.current;
    const elements = () => Array.from(node.querySelectorAll<HTMLElement>(focusable)).filter((item) => !item.closest('[inert]'));
    // The drawer can still be offscreen while its opening transition begins.
    // Moving focus must not scroll its clipped ancestors into view.
    const focusFirst = () => (elements()[0] ?? node).focus({ preventScroll: true });
    if (!node.contains(document.activeElement)) focusFirst();
    const onFocus = (event: FocusEvent) => {
      if (!node.contains(event.target as Node)) focusFirst();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = elements();
      const first = items[0];
      const last = items[items.length - 1];
      if (!items.length || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener('focusin', onFocus);
    node.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('focusin', onFocus);
      node.removeEventListener('keydown', onKey);
      // Restore after React finishes restoring selection for this commit.
      queueMicrotask(() => {
        const target = restore?.isConnected ? restore : document.querySelector<HTMLElement>('[data-focus-fallback]');
        target?.focus({ preventScroll: true });
      });
    };
  }, [active, restoreTarget]);
  return ref;
}
