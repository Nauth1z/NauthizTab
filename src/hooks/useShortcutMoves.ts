import { useMemo, useState } from 'react';
import { reflowShortcutsForSearch, searchWidgetSlots } from '../lib/layout';
import { moveOrSwapShortcut } from '../lib/shortcuts';
import { moveStoredShortcut } from '../storage/appStorage';
import type { AppData, Shortcut } from '../types';

interface Move { id: string; slot: number; searchSlot: number }

export function useShortcutMoves(shortcuts: Shortcut[], searchSlot: number, onCommit: (data: AppData) => void, onError: (message: string) => void) {
  const [pending, setPending] = useState<Move[]>([]);
  // Keep local drops visible while persistence is pending, rebasing on live data.
  const visibleShortcuts = useMemo(() => pending.reduce(
    (current, move) => moveOrSwapShortcut(
      reflowShortcutsForSearch(current, move.searchSlot), move.id, move.slot, new Set(searchWidgetSlots(move.searchSlot)),
    ), shortcuts,
  ), [shortcuts, pending]);

  const move = (id: string, slot: number, visibleSearchSlot = searchSlot): boolean => {
    const layout = reflowShortcutsForSearch(visibleShortcuts, visibleSearchSlot);
    if (moveOrSwapShortcut(layout, id, slot, new Set(searchWidgetSlots(visibleSearchSlot))) === layout) return false;
    const operation = { id, slot, searchSlot: visibleSearchSlot };
    setPending((current) => [...current, operation]);
    void moveStoredShortcut(id, slot).then(onCommit).catch(() => {
      onError('快捷方式位置保存失败，已恢复已保存的位置。');
    }).finally(() => {
      // An older completion must not clear a newer drop or other tabs' updates.
      setPending((current) => current.filter((item) => item !== operation));
    });
    return true;
  };

  return { shortcuts: visibleShortcuts, move };
}
