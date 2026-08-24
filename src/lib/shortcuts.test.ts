import { describe, expect, it } from 'vitest';
import type { Shortcut } from '../types';
import { firstEmptySlot, moveOrSwapShortcut, nameFromUrl, normalizeShortcutUrl } from './shortcuts';

function shortcut(id: string, slot: number): Shortcut {
  return { id, slot, name: id, url: `https://${id}.example/`, iconMode: 'favicon', createdAt: 1 };
}

describe('快捷方式 URL', () => {
  it('为裸域名补全 https 并生成默认名称', () => {
    const url = normalizeShortcutUrl('example.com/path');
    expect(url).toBe('https://example.com/path');
    expect(nameFromUrl(url)).toBe('example.com');
  });

  it.each(['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/test', 'chrome://settings', 'edge://settings'])(
    '拒绝危险或内部协议 %s',
    (url) => expect(() => normalizeShortcutUrl(url)).toThrow('URL 协议不允许'),
  );

  it('拒绝无效 URL', () => {
    expect(() => normalizeShortcutUrl('https://')).toThrow('URL 无效');
  });
});

describe('快捷方式槽位', () => {
  it('返回第一个空槽位', () => {
    expect(firstEmptySlot([shortcut('a', 0), shortcut('b', 2)])).toBe(1);
  });

  it('拖到空槽位时移动且不重排其他图标', () => {
    const result = moveOrSwapShortcut([shortcut('a', 0), shortcut('b', 2)], 'a', 5);
    expect(result.map(({ id, slot }) => ({ id, slot }))).toEqual([{ id: 'a', slot: 5 }, { id: 'b', slot: 2 }]);
  });

  it('拖到已占用槽位时交换', () => {
    const result = moveOrSwapShortcut([shortcut('a', 0), shortcut('b', 2)], 'a', 2);
    expect(result.map(({ id, slot }) => ({ id, slot }))).toEqual([{ id: 'a', slot: 2 }, { id: 'b', slot: 0 }]);
  });

  it('24 个槽位占满后返回 null', () => {
    expect(firstEmptySlot(Array.from({ length: 24 }, (_, index) => shortcut(String(index), index)))).toBeNull();
  });
});
