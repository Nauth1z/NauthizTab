import { describe, expect, it } from 'vitest';
import { migrateAppData } from './appStorage';

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
