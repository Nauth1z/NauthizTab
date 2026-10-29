import { GRID_SLOT_COUNT } from '../constants';
import type { Shortcut } from '../types';

export class ShortcutValidationError extends Error {}

export function normalizeShortcutUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new ShortcutValidationError('请输入快捷方式 URL。');
  const hasPort = /^(?:[\w.-]+|\[[\da-fA-F:]+\]):\d+(?:[/?#]|$)/.test(trimmed);
  const hasScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) && !hasPort;
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ShortcutValidationError('URL 无效，请检查后重试。');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ShortcutValidationError('URL 协议不允许，仅支持 http 和 https。');
  }
  return parsed.href;
}

export function nameFromUrl(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '') || '快捷方式';
}

export function firstEmptySlot(shortcuts: Shortcut[], blockedSlots: ReadonlySet<number> = new Set()): number | null {
  const occupied = new Set(shortcuts.map((item) => item.slot));
  for (let slot = 0; slot < GRID_SLOT_COUNT; slot += 1) {
    if (!occupied.has(slot) && !blockedSlots.has(slot)) return slot;
  }
  return null;
}

export function moveOrSwapShortcut(
  shortcuts: Shortcut[],
  activeId: string,
  targetSlot: number,
  blockedSlots: ReadonlySet<number> = new Set(),
): Shortcut[] {
  const active = shortcuts.find((item) => item.id === activeId);
  if (!active || active.slot === targetSlot || targetSlot < 0 || targetSlot >= GRID_SLOT_COUNT || blockedSlots.has(targetSlot)) return shortcuts;
  const occupant = shortcuts.find((item) => item.slot === targetSlot);
  return shortcuts.map((item) => {
    if (item.id === active.id) return { ...item, slot: targetSlot };
    if (occupant && item.id === occupant.id) return { ...item, slot: active.slot };
    return item;
  });
}

export function isValidShortcut(value: unknown, slotCount = GRID_SLOT_COUNT): value is Shortcut {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Shortcut>;
  return typeof item.id === 'string' && typeof item.name === 'string' && typeof item.url === 'string'
    && (item.iconMode === 'favicon' || item.iconMode === 'custom')
    && Number.isInteger(item.slot) && Number(item.slot) >= 0 && Number(item.slot) < slotCount
    && typeof item.createdAt === 'number';
}
