import {
  DEFAULT_SEARCH_SLOT,
  GRID_COLUMNS,
  GRID_ROWS,
  GRID_SLOT_COUNT,
  SEARCH_WIDGET_COLUMNS,
  SEARCH_WIDGET_ROWS,
} from '../constants';
import type { Shortcut } from '../types';

export interface GridPosition {
  column: number;
  row: number;
}

export function slotToPosition(slot: number): GridPosition {
  return {
    column: slot % GRID_COLUMNS,
    row: Math.floor(slot / GRID_COLUMNS),
  };
}

export function positionToSlot(column: number, row: number): number {
  return row * GRID_COLUMNS + column;
}

export function isValidGridSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < GRID_SLOT_COUNT;
}

export function isValidSearchSlot(slot: number): boolean {
  if (!isValidGridSlot(slot)) return false;
  const { column, row } = slotToPosition(slot);
  return column + SEARCH_WIDGET_COLUMNS <= GRID_COLUMNS
    && row + SEARCH_WIDGET_ROWS <= GRID_ROWS;
}

export function normalizeSearchSlot(slot: unknown): number {
  return typeof slot === 'number' && isValidSearchSlot(slot) ? slot : DEFAULT_SEARCH_SLOT;
}

export function searchWidgetSlots(searchSlot: number): number[] {
  const anchor = normalizeSearchSlot(searchSlot);
  const { column, row } = slotToPosition(anchor);
  const slots: number[] = [];
  for (let rowOffset = 0; rowOffset < SEARCH_WIDGET_ROWS; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < SEARCH_WIDGET_COLUMNS; columnOffset += 1) {
      slots.push(positionToSlot(column + columnOffset, row + rowOffset));
    }
  }
  return slots;
}

function gridDistance(fromSlot: number, toSlot: number): number {
  const from = slotToPosition(fromSlot);
  const to = slotToPosition(toSlot);
  return Math.abs(from.column - to.column) + Math.abs(from.row - to.row);
}

function nearestFreeSlot(originSlot: number, occupied: ReadonlySet<number>, reserved: ReadonlySet<number>): number | null {
  let bestSlot: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let slot = 0; slot < GRID_SLOT_COUNT; slot += 1) {
    if (occupied.has(slot) || reserved.has(slot)) continue;
    const distance = gridDistance(originSlot, slot);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestSlot = slot;
    }
  }
  return bestSlot;
}

export function reflowShortcutsForSearch(shortcuts: Shortcut[], searchSlot: number): Shortcut[] {
  const reserved = new Set(searchWidgetSlots(searchSlot));
  const colliding = shortcuts
    .filter((shortcut) => reserved.has(shortcut.slot))
    .sort((left, right) => left.slot - right.slot || left.createdAt - right.createdAt);
  if (colliding.length === 0) return shortcuts;

  const collidingIds = new Set(colliding.map((shortcut) => shortcut.id));
  const occupied = new Set(
    shortcuts
      .filter((shortcut) => !collidingIds.has(shortcut.id))
      .map((shortcut) => shortcut.slot),
  );
  const replacements = new Map<string, number>();

  for (const shortcut of colliding) {
    const destination = nearestFreeSlot(shortcut.slot, occupied, reserved);
    if (destination === null) return shortcuts;
    occupied.add(destination);
    replacements.set(shortcut.id, destination);
  }

  return shortcuts.map((shortcut) => {
    const replacement = replacements.get(shortcut.id);
    return replacement === undefined ? shortcut : { ...shortcut, slot: replacement };
  });
}

export function legacySlotToGridSlot(slot: number): number {
  const legacyColumn = slot % 6;
  const legacyRow = Math.floor(slot / 6);
  return positionToSlot(legacyColumn + 2, legacyRow + 2);
}
