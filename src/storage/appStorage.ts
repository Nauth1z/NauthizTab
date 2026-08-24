import { SEARCH_PROVIDERS } from '../constants';
import { isValidShortcut } from '../lib/shortcuts';
import type { AppData, SearchProviderId, Shortcut, WallpaperMetadata } from '../types';

const STORAGE_KEY = 'appData';
const defaultData: AppData = {
  schemaVersion: 1,
  preferences: { searchProvider: 'bing' },
  shortcuts: [],
  wallpaperMetadata: null,
};

function isProvider(value: unknown): value is SearchProviderId {
  return SEARCH_PROVIDERS.some((provider) => provider.id === value);
}

export function migrateAppData(raw: unknown): AppData {
  if (!raw || typeof raw !== 'object') return structuredClone(defaultData);
  const candidate = raw as Partial<AppData>;
  if (candidate.schemaVersion !== 1) return structuredClone(defaultData);
  const shortcuts = Array.isArray(candidate.shortcuts)
    ? candidate.shortcuts.filter(isValidShortcut).slice(0, 24)
    : [];
  const seenSlots = new Set<number>();
  const uniqueShortcuts = shortcuts.filter((shortcut) => {
    if (seenSlots.has(shortcut.slot)) return false;
    seenSlots.add(shortcut.slot);
    return true;
  });
  return {
    schemaVersion: 1,
    preferences: {
      searchProvider: isProvider(candidate.preferences?.searchProvider)
        ? candidate.preferences.searchProvider
        : 'bing',
    },
    shortcuts: uniqueShortcuts,
    wallpaperMetadata: candidate.wallpaperMetadata ?? null,
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

export async function saveWallpaperMetadata(wallpaperMetadata: WallpaperMetadata | null): Promise<void> {
  await updateData((data) => ({ ...data, wallpaperMetadata }));
}
