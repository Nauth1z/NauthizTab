import { describe, expect, it } from 'vitest';
import { migrateAppData } from './appStorage';

describe('数据迁移入口', () => {
  it('无数据时创建版本 1 默认配置并使用 Bing', () => {
    expect(migrateAppData(undefined)).toEqual({
      schemaVersion: 1,
      preferences: { searchProvider: 'bing' },
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
  });
});
