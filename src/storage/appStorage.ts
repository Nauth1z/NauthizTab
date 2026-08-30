import { DEFAULT_SEARCH_SLOT, MAX_SHORTCUTS, SEARCH_PROVIDERS } from '../constants';
import { legacySlotToGridSlot, normalizeSearchSlot, reflowShortcutsForSearch } from '../lib/layout';
import { isValidShortcut } from '../lib/shortcuts';
import type { AppData, SearchProviderId, Shortcut, WallpaperMetadata } from '../types';

const STORAGE_KEY = 'appData';
const defaultData: AppData = {
  schemaVersion: 2,
  preferences: { searchProvider: 'bing' },
  layout: { searchSlot: DEFAULT_SEARCH_SLOT },
  shortcuts: [],
  wallpaperMetadata: null,
};

function isProvider(value: unknown): value is SearchProviderId {
  return SEARCH_PROVIDERS.some((provider) => provider.id === value);
}

export function migrateAppData(raw: unknown): AppData {
  if (!raw || typeof raw !== 'object') return structuredClone(defaultData);
  const candidate = raw as Record<string, unknown>;
  if (candidate.schemaVersion !== 1 && candidate.schemaVersion !== 2) return structuredClone(defaultData);
  const isLegacy = candidate.schemaVersion === 1;
  const rawLayout = candidate.layout && typeof candidate.layout === 'object'
    ? candidate.layout as Record<string, unknown>
    : null;
  const rawPreferences = candidate.preferences && typeof candidate.preferences === 'object'
    ? candidate.preferences as Record<string, unknown>
    : null;
  const searchSlot = isLegacy ? DEFAULT_SEARCH_SLOT : normalizeSearchSlot(rawLayout?.searchSlot);
  const shortcuts = Array.isArray(candidate.shortcuts)
    ? candidate.shortcuts
      .filter((shortcut) => isValidShortcut(shortcut, isLegacy ? 24 : undefined))
      .slice(0, MAX_SHORTCUTS)
      .map((shortcut) => isLegacy ? { ...shortcut, slot: legacySlotToGridSlot(shortcut.slot) } : shortcut)
    : [];
  const seenSlots = new Set<number>();
  const uniqueShortcuts = shortcuts.filter((shortcut) => {
    if (seenSlots.has(shortcut.slot)) return false;
    seenSlots.add(shortcut.slot);
    return true;
  });
  return {
    schemaVersion: 2,
    preferences: {
      searchProvider: isProvider(rawPreferences?.searchProvider)
        ? rawPreferences.searchProvider
        : 'bing',
    },
    layout: { searchSlot },
    shortcuts: reflowShortcutsForSearch(uniqueShortcuts, searchSlot),
    wallpaperMetadata: candidate.wallpaperMetadata as WallpaperMetadata | null ?? null,
  };
}

export async function loadAppData(): Promise<AppData> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const data = migrateAppData(result[STORAGE_KEY]);
  if (!result[STORAGE_KEY] || JSON.stringify(result[STORAGE_KEY]) !== JSON.stringify(data)) {
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
  }
  return data;
}

async function updateData(update: (data: AppData) => AppData): Promise<AppData> {
  const current = await loadAppData();
  const next = update(current);
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export async function saveSearchProvider(searchProvider: SearchProviderId): Promise<void> {
  await updateData((data) => ({ ...data, preferences: { ...data.preferences, searchProvider } }));
}

export async function saveShortcuts(shortcuts: Shortcut[]): Promise<void> {
  await updateData((data) => ({ ...data, shortcuts }));
}

export async function saveLayout(shortcuts: Shortcut[], searchSlot: number): Promise<void> {
  await updateData((data) => ({ ...data, shortcuts, layout: { searchSlot } }));
}

export async function saveWallpaperMetadata(wallpaperMetadata: WallpaperMetadata | null): Promise<void> {
  await updateData((data) => ({ ...data, wallpaperMetadata }));
}
