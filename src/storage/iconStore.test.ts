import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deleteCustomIcon, saveCustomIcon } from './iconStore';

let transaction: { oncomplete?: () => void; onabort?: () => void; onerror?: () => void; error: DOMException | null; objectStore: () => unknown };
let request: { result: string; onsuccess?: () => void };
const close = vi.fn();

beforeEach(() => {
  close.mockClear();
  request = { result: 'icon' };
  transaction = { error: null, objectStore: () => ({ put: () => request, delete: () => request }) };
  vi.stubGlobal('indexedDB', {
    open: () => {
      const opening = { result: { transaction: () => transaction, close }, onsuccess: undefined as (() => void) | undefined };
      queueMicrotask(() => opening.onsuccess?.());
      return opening;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('图标请求成功后仍等待事务提交', async () => {
  let finished = false;
  const saving = saveCustomIcon(new Blob(['icon'])).then((id) => { finished = true; return id; });
  await vi.waitFor(() => expect(transaction.oncomplete).toBeTypeOf('function'));
  request.onsuccess?.();
  await Promise.resolve();
  expect(finished).toBe(false);
  transaction.oncomplete?.();
  expect(await saving).toBeTypeOf('string');
  expect(close).toHaveBeenCalledOnce();
});

it('请求成功后事务中止仍报告失败并关闭连接', async () => {
  const saving = saveCustomIcon(new Blob(['icon']));
  const rejected = expect(saving).rejects.toThrow('自定义图标保存失败');
  await vi.waitFor(() => expect(transaction.oncomplete).toBeTypeOf('function'));
  request.onsuccess?.();
  transaction.error = new DOMException('disk full', 'QuotaExceededError');
  transaction.onabort?.();
  await rejected;
  expect(close).toHaveBeenCalledOnce();
});

it('删除图标同样等待事务提交', async () => {
  let finished = false;
  const deleting = deleteCustomIcon('icon').then(() => { finished = true; });
  await vi.waitFor(() => expect(transaction.oncomplete).toBeTypeOf('function'));
  expect(finished).toBe(false);
  transaction.oncomplete?.();
  await deleting;
  expect(finished).toBe(true);
});
