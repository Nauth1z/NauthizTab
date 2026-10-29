import { useState, type PointerEvent } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSearchDrag } from './useSearchDrag';
import { SEARCH_DRAG_HOLD_MS } from '../constants';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

function setup() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const input = document.createElement('input');
  input.setPointerCapture = vi.fn(); input.hasPointerCapture = () => true; input.releasePointerCapture = vi.fn();
  const grid = document.createElement('div'); const widget = document.createElement('div');
  grid.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 700 }) as DOMRect;
  widget.getBoundingClientRect = () => ({ left: 200, top: 0 }) as DOMRect;
  const onError = vi.fn(); const onSave = vi.fn();
  const view = renderHook(() => {
    const [slot, setSlot] = useState(2);
    const drag = useSearchDrag({
      searchSlot: slot, query: '', providerOpen: false,
      gridRef: { current: grid }, widgetRef: { current: widget },
      onSave: async (next) => { onSave(next); await pending; setSlot(next); }, onError,
    });
    return { ...drag, slot };
  });
  const event = (y: number) => ({ pointerType: 'mouse', button: 0, pointerId: 1, clientX: 250, clientY: y, currentTarget: input, preventDefault() {} }) as PointerEvent<HTMLInputElement>;
  const begin = () => {
    act(() => view.result.current.begin(event(50)));
    act(() => vi.advanceTimersByTime(SEARCH_DRAG_HOLD_MS));
    act(() => view.result.current.move(event(250)));
  };
  const drop = () => { begin(); act(() => view.result.current.end(event(250))); };
  return { ...view, begin, drop, pending, resolve, reject, onError, onSave };
}

it.each(['blur', 'Escape'])('松手后保存期间的 %s 不会撤销已显示的位置', async (action) => {
  const view = setup(); view.drop();
  expect(view.onSave).toHaveBeenCalledWith(22);
  expect(view.result.current.preview?.searchSlot).toBe(22);
  act(() => {
    if (action === 'blur') window.dispatchEvent(new Event('blur'));
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  expect(view.result.current.preview?.searchSlot).toBe(22);
  await act(async () => { view.resolve(); await view.pending; });
  expect(view.result.current.slot).toBe(22);
  expect(view.result.current.preview).toBeNull();
});

it('仍可取消正在进行的拖动', () => {
  const view = setup(); view.begin();
  expect(view.result.current.dragging).toBe(true);
  act(() => window.dispatchEvent(new Event('blur')));
  expect(view.result.current.dragging).toBe(false);
  expect(view.result.current.preview).toBeNull();
  expect(view.onSave).not.toHaveBeenCalled();
});

it('保存失败时回到已保存的位置', async () => {
  const view = setup(); view.drop();
  await act(async () => { view.reject(new Error('storage failed')); await view.pending.catch(() => {}); });
  expect(view.result.current.slot).toBe(2);
  expect(view.result.current.preview).toBeNull();
  expect(view.onError).toHaveBeenCalledOnce();
});
