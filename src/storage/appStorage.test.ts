import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addStoredShortcut, loadAppData, migrateAppData, moveStoredShortcut, removeStoredShortcut, saveSearchLayout, saveSearchProvider, subscribeAppData, updateStoredShortcut, updateStoredShortcutIcon } from './appStorage';
import { installTestLocks } from '../test/locks';
import type { AppData } from '../types';

vi.mock('./iconStore', () => ({ deleteCustomIcon: vi.fn(async () => {}) }));

describe('数据迁移入口', () => {
  it('无数据时创建版本 2 默认配置并使用 Bing', () => {
    expect(migrateAppData(undefined)).toEqual({
      schemaVersion: 2,
      preferences: { searchProvider: 'bing' },
      layout: { searchSlot: 2 },
      shortcuts: [],
      wallpaperMetadata: null,
    });
  });

  it('清理重复槽位和无效提供商', () => {
    const common = { name: 'A', url: 'https://example.com/', iconMode: 'favicon', createdAt: 1 };
    const result = migrateAppData({
      schemaVersion: 1,
      preferences: { searchProvider: 'invalid' },
      shortcuts: [{ ...common, id: 'a', slot: 2 }, { ...common, id: 'b', slot: 2 }],
      wallpaperMetadata: null,
    });
    expect(result.preferences.searchProvider).toBe('bing');
    expect(result.shortcuts).toHaveLength(1);
    expect(result.shortcuts[0].slot).toBe(24);
  });

  it('修复版本 2 中与搜索框重叠的图标', () => {
    const result = migrateAppData({
      schemaVersion: 2,
      preferences: { searchProvider: 'google' },
      layout: { searchSlot: 0 },
      shortcuts: [{ id: 'a', name: 'A', url: 'https://example.com/', iconMode: 'favicon', createdAt: 1, slot: 0 }],
      wallpaperMetadata: null,
    });
    expect(result.layout.searchSlot).toBe(0);
    expect(result.shortcuts[0].slot).toBe(10);
  });
});

describe('跨页面存储', () => {
  let stored: AppData;
  let restoreLocks: () => void;
  const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>();
  const write = vi.fn(async (value: { appData: AppData }) => {
    const oldValue = stored;
    stored = structuredClone(value.appData);
    listeners.forEach((listener) => listener({ appData: { oldValue, newValue: stored } }, 'local'));
  });
  beforeEach(() => {
    restoreLocks = installTestLocks();
    stored = migrateAppData(undefined);
    listeners.clear(); write.mockClear();
    vi.stubGlobal('chrome', { storage: {
      local: { get: async () => ({ appData: structuredClone(stored) }), set: write },
      onChanged: { addListener: (listener: typeof listeners extends Set<infer T> ? T : never) => listeners.add(listener), removeListener: (listener: typeof listeners extends Set<infer T> ? T : never) => listeners.delete(listener) },
    } });
  });
  afterEach(() => { restoreLocks(); vi.unstubAllGlobals(); });
  const shortcut = (id: string) => ({ id, name: id, url: `https://${id}.example/`, iconMode: 'favicon' as const, createdAt: 1 });

  it('并发修改不同配置不会互相覆盖', async () => {
    await Promise.all([saveSearchProvider('google'), addStoredShortcut(shortcut('a'))]);
    expect(stored.preferences.searchProvider).toBe('google');
    expect(stored.shortcuts.map((item) => item.id)).toEqual(['a']);
    expect(stored.revision).toBe(2);
  });

  it('两个页面同时添加时保留全部快捷方式并分配不同槽位', async () => {
    await Promise.all([addStoredShortcut(shortcut('a')), addStoredShortcut(shortcut('b'))]);
    expect(stored.shortcuts).toHaveLength(2);
    expect(new Set(stored.shortcuts.map((item) => item.slot)).size).toBe(2);
  });

  it('并发添加不会突破 24 个快捷方式限制', async () => {
    for (let index = 0; index < 23; index++) await addStoredShortcut(shortcut(`site${index}`));
    const results = await Promise.allSettled([addStoredShortcut(shortcut('last')), addStoredShortcut(shortcut('overflow'))]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(stored.shortcuts).toHaveLength(24);
  });

  it('一次写入失败不会阻塞后续保存或更改原数据', async () => {
    write.mockRejectedValueOnce(new Error('disk failed'));
    await expect(saveSearchProvider('google')).rejects.toThrow('disk failed');
    expect(stored.preferences.searchProvider).toBe('bing');
    await saveSearchProvider('baidu');
    expect(stored.preferences.searchProvider).toBe('baidu');
  });

  it('旧页面按 ID 修改和拖动不会丢失新页面添加的快捷方式', async () => {
    await addStoredShortcut(shortcut('a'));
    await addStoredShortcut(shortcut('b'));
    await updateStoredShortcut('a', { name: 'new name' });
    await moveStoredShortcut('a', 10);
    expect(stored.shortcuts.map((item) => item.id)).toEqual(['a', 'b']);
    expect(stored.shortcuts[0]).toMatchObject({ name: 'new name', slot: 10 });
  });

  it('移动搜索框基于最新快捷方式重排', async () => {
    await addStoredShortcut(shortcut('a'));
    await addStoredShortcut(shortcut('b'));
    await saveSearchLayout(0);
    expect(stored.shortcuts).toHaveLength(2);
    expect(stored.shortcuts.every((item) => item.slot >= 6)).toBe(true);
  });

  it('不会让旧页面复活已删除的快捷方式', async () => {
    await addStoredShortcut(shortcut('a'));
    await removeStoredShortcut('a');
    await expect(updateStoredShortcut('a', { name: 'old edit' })).rejects.toThrow('已被其他页面删除');
    expect(stored.shortcuts).toEqual([]);
  });

  it('保留图标时使用最新记录，缺少自定义文件时拒绝切换', async () => {
    await addStoredShortcut(shortcut('a'));
    await expect(updateStoredShortcutIcon('a', 'custom')).rejects.toThrow('请选择自定义图标');
    await updateStoredShortcutIcon('a', 'custom', 'new-icon');
    await updateStoredShortcutIcon('a', 'custom');
    expect(stored.shortcuts[0].customIconId).toBe('new-icon');
  });

  it('通知其他页面，解除订阅后停止通知', async () => {
    const changed = vi.fn(); const failed = vi.fn();
    const unsubscribe = subscribeAppData(changed, failed);
    await saveSearchProvider('baidu');
    expect(changed).toHaveBeenCalledWith(stored);
    unsubscribe();
    await saveSearchProvider('google');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it('遇到未知版本时不覆盖原数据，也不允许写入', async () => {
    const raw = { ...stored, schemaVersion: 3, shortcuts: [shortcut('saved')] };
    stored = raw as unknown as AppData;
    await expect(loadAppData()).rejects.toThrow('原始数据已保留');
    await expect(saveSearchProvider('google')).rejects.toThrow('原始数据已保留');
    expect(stored).toEqual(raw);
    expect(write).not.toHaveBeenCalled();
  });
});
