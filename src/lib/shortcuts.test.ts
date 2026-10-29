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

  it.each(['example.com:8080/path', 'localhost:3000', '192.168.1.1:8080', '[::1]:3000'])('支持带端口的裸地址 %s', (input) => {
    expect(normalizeShortcutUrl(input)).toBe(new URL(`https://${input}`).href);
  });
});

describe('快捷方式槽位', () => {
  it('返回第一个没有被搜索框占用的空槽位', () => {
    expect(firstEmptySlot([shortcut('a', 6)], new Set([0, 1, 2, 3, 4, 5]))).toBe(7);
  });

  it('拖到空槽位时移动且不重排其他图标', () => {
    const result = moveOrSwapShortcut([shortcut('a', 0), shortcut('b', 2)], 'a', 5);
    expect(result.map(({ id, slot }) => ({ id, slot }))).toEqual([{ id: 'a', slot: 5 }, { id: 'b', slot: 2 }]);
  });

  it('拖到已占用槽位时交换', () => {
    const result = moveOrSwapShortcut([shortcut('a', 0), shortcut('b', 2)], 'a', 2);
    expect(result.map(({ id, slot }) => ({ id, slot }))).toEqual([{ id: 'a', slot: 2 }, { id: 'b', slot: 0 }]);
  });

  it('允许移动到扩展网格的末尾', () => {
    const result = moveOrSwapShortcut([shortcut('a', 0)], 'a', 69);
    expect(result[0].slot).toBe(69);
  });

  it('拒绝移动到搜索框占用的槽位', () => {
    const shortcuts = [shortcut('a', 20)];
    expect(moveOrSwapShortcut(shortcuts, 'a', 2, new Set([2, 3, 4, 5, 6, 7]))).toBe(shortcuts);
  });

  it('70 个槽位占满后返回 null', () => {
    expect(firstEmptySlot(Array.from({ length: 70 }, (_, index) => shortcut(String(index), index)))).toBeNull();
  });
});
