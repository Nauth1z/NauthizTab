import { useState } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useShortcutMoves } from './useShortcutMoves';
import { moveStoredShortcut } from '../storage/appStorage';
import type { AppData } from '../types';

vi.mock('../storage/appStorage', () => ({ moveStoredShortcut: vi.fn() }));
const save = vi.mocked(moveStoredShortcut);
const onError = vi.fn();
const onCommit = vi.fn();
const initial: AppData = {
  schemaVersion: 2, preferences: { searchProvider: 'bing' }, layout: { searchSlot: 2 }, wallpaperMetadata: null,
  shortcuts: [
    { id: 'a', name: 'A', url: 'https://a.example/', iconMode: 'favicon', slot: 0, createdAt: 1 },
    { id: 'b', name: 'B', url: 'https://b.example/', iconMode: 'favicon', slot: 1, createdAt: 1 },
  ],
};

function deferred() {
  let resolve!: (data: AppData) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<AppData>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(initialData = initial) {
  return renderHook(() => {
    const [data, replaceData] = useState(initialData);
    const moves = useShortcutMoves(data.shortcuts, data.layout.searchSlot, (next) => { onCommit(next); replaceData(next); }, onError);
    return { ...moves, replaceData };
  });
}
function positions(shortcuts: AppData['shortcuts']) {
  return shortcuts.map(({ id, slot }) => ({ id, slot }));
}
beforeEach(() => { save.mockReset(); onError.mockClear(); onCommit.mockClear(); });
afterEach(cleanup);

it('松手后立即交换位置，保存完成后保持相同位置', async () => {
  const saving = deferred(); save.mockReturnValueOnce(saving.promise);
  const { result } = setup();
  act(() => { expect(result.current.move('a', 1)).toBe(true); });
  expect(positions(result.current.shortcuts)).toEqual([{ id: 'a', slot: 1 }, { id: 'b', slot: 0 }]);
  expect(onCommit).not.toHaveBeenCalled();
  const committed = { ...initial, shortcuts: result.current.shortcuts, revision: 1 };
  await act(async () => { saving.resolve(committed); await saving.promise; });
  expect(positions(result.current.shortcuts)).toEqual(positions(committed.shortcuts));
  expect(onCommit).toHaveBeenCalledWith(committed);
});

it('保存失败回退位置，同时保留其他页面的新数据', async () => {
  const saving = deferred(); save.mockReturnValueOnce(saving.promise);
  const { result } = setup();
  act(() => { result.current.move('a', 10); });
  const remote: AppData = { ...initial, revision: 1, shortcuts: [...initial.shortcuts, { ...initial.shortcuts[0], id: 'c', slot: 20 }] };
  act(() => { result.current.replaceData(remote); });
  expect(positions(result.current.shortcuts)).toEqual([{ id: 'a', slot: 10 }, { id: 'b', slot: 1 }, { id: 'c', slot: 20 }]);
  await act(async () => { saving.reject(new Error('disk failed')); await saving.promise.catch(() => {}); });
  expect(positions(result.current.shortcuts)).toEqual(positions(remote.shortcuts));
  expect(onError).toHaveBeenCalledOnce();
});

it('较早的保存完成不会清除后续拖拽的位置', async () => {
  const first = deferred(); const second = deferred();
  save.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { result } = setup();
  act(() => { result.current.move('a', 1); });
  act(() => { result.current.move('b', 10); });
  expect(positions(result.current.shortcuts)).toEqual([{ id: 'a', slot: 1 }, { id: 'b', slot: 10 }]);
  await act(async () => {
    first.resolve({ ...initial, revision: 1, shortcuts: [{ ...initial.shortcuts[0], slot: 1 }, { ...initial.shortcuts[1], slot: 0 }] });
    await first.promise;
  });
  expect(positions(result.current.shortcuts)).toEqual([{ id: 'a', slot: 1 }, { id: 'b', slot: 10 }]);
  const final = { ...initial, revision: 2, shortcuts: result.current.shortcuts };
  await act(async () => { second.resolve(final); await second.promise; });
  expect(positions(result.current.shortcuts)).toEqual(positions(final.shortcuts));
});

it('原位松手和无效落点不会触发保存', () => {
  const { result } = setup();
  act(() => {
    expect(result.current.move('a', 0)).toBe(false);
    expect(result.current.move('a', 2)).toBe(false);
    expect(result.current.move('missing', 10)).toBe(false);
  });
  expect(save).not.toHaveBeenCalled();
  expect(result.current.shortcuts).toBe(initial.shortcuts);
});

it('搜索框位置保存期间，可立即放入视觉上已释放的旧槽位', async () => {
  const saving = deferred(); save.mockReturnValueOnce(saving.promise);
  const { result } = setup();
  act(() => { expect(result.current.move('a', 2, 22)).toBe(true); });
  expect(positions(result.current.shortcuts)).toEqual([{ id: 'a', slot: 2 }, { id: 'b', slot: 1 }]);
  const committed = { ...initial, revision: 2, layout: { searchSlot: 22 }, shortcuts: result.current.shortcuts };
  await act(async () => { saving.resolve(committed); await saving.promise; });
  expect(positions(result.current.shortcuts)).toEqual(positions(committed.shortcuts));
});

it('交换被搜索预览让位的图标时，按当前视觉位置交换', async () => {
  const saving = deferred(); save.mockReturnValueOnce(saving.promise);
  const data = { ...initial, shortcuts: [initial.shortcuts[0], { ...initial.shortcuts[1], slot: 22 }] };
  const { result } = setup(data);
  act(() => { expect(result.current.move('a', 12, 22)).toBe(true); });
  expect(positions(result.current.shortcuts)).toEqual([{ id: 'a', slot: 12 }, { id: 'b', slot: 0 }]);
  const committed = { ...data, revision: 2, layout: { searchSlot: 22 }, shortcuts: result.current.shortcuts };
  await act(async () => { saving.resolve(committed); await saving.promise; });
  expect(positions(result.current.shortcuts)).toEqual(positions(committed.shortcuts));
});
