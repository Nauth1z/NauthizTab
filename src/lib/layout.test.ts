import { describe, expect, it } from 'vitest';
import type { Shortcut } from '../types';
import {
  isValidSearchSlot,
  legacySlotToGridSlot,
  reflowShortcutsForSearch,
  searchWidgetSlots,
} from './layout';

function shortcut(id: string, slot: number): Shortcut {
  return { id, slot, name: id, url: `https://${id}.example/`, iconMode: 'favicon', createdAt: Number(id) || 1 };
}

describe('10 × 7 桌面布局', () => {
  it('搜索框占用连续的 6 × 1 格', () => {
    expect(searchWidgetSlots(2)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(searchWidgetSlots(64)).toEqual([64, 65, 66, 67, 68, 69]);
  });

  it('拒绝会越过行边界的搜索框锚点', () => {
    expect(isValidSearchSlot(4)).toBe(true);
    expect(isValidSearchSlot(5)).toBe(false);
    expect(isValidSearchSlot(64)).toBe(true);
  });

  it('只移动与搜索框冲突的图标，并选择最近空格', () => {
    const shortcuts = [shortcut('1', 0), shortcut('2', 1), shortcut('3', 20)];
    const result = reflowShortcutsForSearch(shortcuts, 0);
    expect(result.map(({ id, slot }) => ({ id, slot }))).toEqual([
      { id: '1', slot: 10 },
      { id: '2', slot: 11 },
      { id: '3', slot: 20 },
    ]);
  });

  it('满 24 个图标时仍能保证槽位唯一且不与搜索框重叠', () => {
    const shortcuts = Array.from({ length: 24 }, (_, index) => shortcut(String(index), index));
    const result = reflowShortcutsForSearch(shortcuts, 0);
    const slots = result.map((item) => item.slot);
    expect(new Set(slots)).toHaveLength(24);
    expect(slots.some((slot) => searchWidgetSlots(0).includes(slot))).toBe(false);
  });

  it('将旧 6 × 4 槽位映射到新网格中部', () => {
    expect(legacySlotToGridSlot(0)).toBe(22);
    expect(legacySlotToGridSlot(23)).toBe(57);
  });
});
