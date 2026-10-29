import { useLayoutEffect, type RefObject } from 'react';

export function useMenuNavigation(ref: RefObject<HTMLDivElement | null>, open: boolean) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!open || !node) return;
    const items = () => Array.from(node.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    (node.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? items()[0])?.focus();
    const onKey = (event: KeyboardEvent) => {
      const buttons = items();
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      let index: number;
      if (event.key === 'ArrowDown') index = (current + 1) % buttons.length;
      else if (event.key === 'ArrowUp') index = (current - 1 + buttons.length) % buttons.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = buttons.length - 1;
      else return;
      event.preventDefault();
      buttons[index]?.focus();
    };
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
  }, [open, ref]);
}
