import { DEFAULT_SEARCH_SLOT, MAX_SHORTCUTS, SEARCH_PROVIDERS } from '../constants';
import { isValidSearchSlot, legacySlotToGridSlot, normalizeSearchSlot, reflowShortcutsForSearch, searchWidgetSlots } from '../lib/layout';
import { firstEmptySlot, isValidShortcut, moveOrSwapShortcut, normalizeShortcutUrl, ShortcutValidationError } from '../lib/shortcuts';
import { withLock } from './locks';
import { deleteCustomIcon } from './iconStore';
import type { AppData, SearchProviderId, Shortcut, WallpaperMetadata } from '../types';

const STORAGE_KEY = 'appData';
export class UnsupportedDataVersionError extends Error {
  constructor() { super('本地数据版本不兼容，请更新扩展后重试。原始数据已保留。'); }
}
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
  if (candidate.schemaVersion !== 1 && candidate.schemaVersion !== 2) throw new UnsupportedDataVersionError();
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
  const seenIds = new Set<string>();
  const uniqueShortcuts = shortcuts.filter((shortcut) => {
    if (seenSlots.has(shortcut.slot) || seenIds.has(shortcut.id)) return false;
    seenSlots.add(shortcut.slot);
    seenIds.add(shortcut.id);
    return true;
  });
  return {
    schemaVersion: 2,
    ...(Number.isSafeInteger(candidate.revision) && Number(candidate.revision) >= 0 ? { revision: Number(candidate.revision) } : {}),
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

async function readAppData(): Promise<AppData> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const data = migrateAppData(result[STORAGE_KEY]);
  if (!result[STORAGE_KEY] || JSON.stringify(result[STORAGE_KEY]) !== JSON.stringify(data)) {
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
  }
  return data;
}

export function loadAppData(): Promise<AppData> {
  return withLock('data', readAppData);
}

async function updateData(update: (data: AppData) => AppData): Promise<AppData> {
  return withLock('data', async () => {
    const current = await readAppData();
    const next = { ...update(current), revision: (current.revision ?? 0) + 1 };
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return next;
  });
}

export function subscribeAppData(onData: (data: AppData) => void, onError: (error: unknown) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    try { onData(migrateAppData(changes[STORAGE_KEY].newValue)); }
    catch (error) { onError(error); }
  };
  chrome.storage.onChanged?.addListener(listener);
  return () => chrome.storage.onChanged?.removeListener(listener);
}

export function saveSearchProvider(searchProvider: SearchProviderId): Promise<AppData> {
  return updateData((data) => ({ ...data, preferences: { ...data.preferences, searchProvider } }));
}

export function addStoredShortcut(shortcut: Omit<Shortcut, 'slot'>): Promise<AppData> {
  return updateData((data) => {
    if (data.shortcuts.length >= MAX_SHORTCUTS) throw new ShortcutValidationError('最多只能添加 24 个快捷方式。');
    const slot = firstEmptySlot(data.shortcuts, new Set(searchWidgetSlots(data.layout.searchSlot)));
    if (slot === null) throw new ShortcutValidationError('没有可用的快捷方式槽位。');
    return { ...data, shortcuts: [...data.shortcuts, { ...shortcut, url: normalizeShortcutUrl(shortcut.url), slot }] };
  });
}

export function updateStoredShortcut(id: string, changes: Partial<Pick<Shortcut, 'name' | 'url'>>): Promise<AppData> {
  return updateData((data) => {
    if (!data.shortcuts.some((item) => item.id === id)) throw new ShortcutValidationError('该快捷方式已被其他页面删除。');
    const patch = { ...changes, ...(changes.url !== undefined ? { url: normalizeShortcutUrl(changes.url) } : {}) };
    return { ...data, shortcuts: data.shortcuts.map((item) => item.id === id ? { ...item, ...patch } : item) };
  });
}

async function cleanupUnusedIcon(id: string | undefined, data: AppData): Promise<void> {
  if (id && !data.shortcuts.some((item) => item.customIconId === id)) await deleteCustomIcon(id).catch(() => undefined);
}

export async function updateStoredShortcutIcon(id: string, iconMode: Shortcut['iconMode'], uploadedIconId?: string): Promise<AppData> {
  let previousIcon: string | undefined;
  const next = await updateData((data) => {
    const current = data.shortcuts.find((item) => item.id === id);
    if (!current) throw new ShortcutValidationError('该快捷方式已被其他页面删除。');
    previousIcon = current.customIconId;
    const customIconId = iconMode === 'custom' ? uploadedIconId ?? current.customIconId : undefined;
    if (iconMode === 'custom' && !customIconId) throw new ShortcutValidationError('请选择自定义图标。');
    return { ...data, shortcuts: data.shortcuts.map((item) => item.id === id ? { ...item, iconMode, customIconId } : item) };
  });
  await cleanupUnusedIcon(previousIcon, next);
  return next;
}

export async function removeStoredShortcut(id: string): Promise<AppData> {
  let previousIcon: string | undefined;
  const next = await updateData((data) => {
    previousIcon = data.shortcuts.find((item) => item.id === id)?.customIconId;
    return { ...data, shortcuts: data.shortcuts.filter((item) => item.id !== id) };
  });
  await cleanupUnusedIcon(previousIcon, next);
  return next;
}

export function moveStoredShortcut(id: string, slot: number): Promise<AppData> {
  return updateData((data) => ({ ...data, shortcuts: moveOrSwapShortcut(data.shortcuts, id, slot, new Set(searchWidgetSlots(data.layout.searchSlot))) }));
}

export function saveSearchLayout(searchSlot: number): Promise<AppData> {
  return updateData((data) => {
    if (!isValidSearchSlot(searchSlot)) throw new Error('搜索框位置无效。');
    return { ...data, shortcuts: reflowShortcutsForSearch(data.shortcuts, searchSlot), layout: { searchSlot } };
  });
}

export function saveWallpaperMetadata(wallpaperMetadata: WallpaperMetadata | null): Promise<AppData> {
  return updateData((data) => ({ ...data, wallpaperMetadata }));
}
