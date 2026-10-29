import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import type { AppData } from './types';
import { installTestLocks } from './test/locks';
import * as search from './lib/search';
import { deleteCustomIcon } from './storage/iconStore';

vi.mock('./storage/iconStore', () => ({
  getCustomIcon: vi.fn(async () => null),
  processCustomIcon: vi.fn(async () => new Blob(['icon'])),
  saveCustomIcon: vi.fn(async () => 'uploaded-icon'),
  deleteCustomIcon: vi.fn(async () => {}),
}));

let stored: AppData;
let restoreLocks: () => void;
const storageListeners = new Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>();
const getAnimationsDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'getAnimations');
const setStorage = vi.fn(async (value: { appData: AppData }) => { stored = structuredClone(value.appData); });

beforeEach(() => {
  restoreLocks = installTestLocks();
  stored = {
    schemaVersion: 2,
    preferences: { searchProvider: 'bing' },
    layout: { searchSlot: 2 },
    shortcuts: [{ id: 'site', name: '常用网站', url: 'https://old.example/path?q=1', iconMode: 'favicon', slot: 0, createdAt: 1 }],
    wallpaperMetadata: null,
  };
  setStorage.mockClear();
  storageListeners.clear();
  vi.stubGlobal('chrome', {
    runtime: { id: 'test', getURL: (path: string) => `chrome-extension://test/${path}` },
    storage: {
      local: { get: vi.fn(async () => ({ appData: structuredClone(stored) })), set: setStorage },
      onChanged: {
        addListener: (listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) => storageListeners.add(listener),
        removeListener: (listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) => storageListeners.delete(listener),
      },
    },
  });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] });
});

describe('页面同步和键盘交互', () => {
  it('选择搜索引擎立即生效，保存完成后保持选择', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    setStorage.mockImplementationOnce(async (value: { appData: AppData }) => { await pending; stored = structuredClone(value.appData); });
    const build = vi.spyOn(search, 'buildSearchUrl').mockReturnValue(null);
    render(<App />);
    await screen.findByRole('button', { name: '打开 常用网站' });
    await userEvent.click(screen.getByRole('button', { name: '选择搜索提供商' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Google' }));
    expect(screen.getByPlaceholderText('使用 Google 搜索')).toBeTruthy();
    expect(stored.preferences.searchProvider).toBe('bing');
    const input = screen.getByRole('textbox', { name: '搜索内容' });
    fireEvent.change(input, { target: { value: 'test' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(build).toHaveBeenCalledWith('google', 'test');
    await act(async () => { release(); await pending; });
    await waitFor(() => expect(stored.preferences.searchProvider).toBe('google'));
  });

  it('其他页面的保存实时更新当前页面，并忽略旧版本事件', async () => {
    render(<App />);
    await screen.findByRole('button', { name: '打开 常用网站' });
    const original = structuredClone(stored);
    const next: AppData = { ...stored, revision: 10, preferences: { searchProvider: 'google' }, shortcuts: [{ ...stored.shortcuts[0], name: '其他页面改名' }] };
    act(() => storageListeners.forEach((listener) => listener({ appData: { newValue: next } }, 'local')));
    expect(screen.getByRole('button', { name: '打开 其他页面改名' })).toBeTruthy();
    expect(screen.getByPlaceholderText('使用 Google 搜索')).toBeTruthy();
    act(() => storageListeners.forEach((listener) => listener({ appData: { newValue: original } }, 'local')));
    expect(screen.getByRole('button', { name: '打开 其他页面改名' })).toBeTruthy();
  });

  it('连续切换搜索引擎时，旧保存不清除新选择，失败时回到最新已保存值', async () => {
    let releaseFirst!: () => void; let rejectSecond!: (reason: Error) => void;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const second = new Promise<void>((_resolve, reject) => { rejectSecond = reject; });
    setStorage.mockImplementationOnce(async (value: { appData: AppData }) => { await first; stored = structuredClone(value.appData); });
    setStorage.mockImplementationOnce(async () => { await second; });
    render(<App />);
    await screen.findByRole('button', { name: '打开 常用网站' });
    await userEvent.click(screen.getByRole('button', { name: '选择搜索提供商' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Google' }));
    await userEvent.click(screen.getByRole('button', { name: '选择搜索提供商' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: '百度' }));
    expect(screen.getByPlaceholderText('使用 百度 搜索')).toBeTruthy();
    await act(async () => { releaseFirst(); await first; });
    await waitFor(() => expect(stored.preferences.searchProvider).toBe('google'));
    expect(screen.getByPlaceholderText('使用 百度 搜索')).toBeTruthy();
    await act(async () => { rejectSecond(new Error('storage failed')); await second.catch(() => {}); });
    await waitFor(() => expect(screen.getByPlaceholderText('使用 Google 搜索')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('搜索提供商保存失败');
  });

  it('输入法组合期间的 Enter 不触发搜索，普通 Enter 正常提交', async () => {
    const build = vi.spyOn(search, 'buildSearchUrl').mockReturnValue(null);
    render(<App />);
    await screen.findByRole('button', { name: '打开 常用网站' });
    const input = screen.getByRole('textbox', { name: '搜索内容' });
    fireEvent.change(input, { target: { value: '中文' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(build).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(build).toHaveBeenCalledWith('bing', '中文');
  });

  it('弹窗限制 Tab 焦点，关闭后恢复到快捷方式', async () => {
    render(<App />);
    const dialog = await openUrlDialog();
    const input = within(dialog).getByLabelText('域名或 URL');
    expect(document.activeElement).toBe(input);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '保存' }));
    await userEvent.tab();
    expect(document.activeElement).toBe(input);
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '打开 常用网站' }));
  });

  it('右键菜单支持方向键、Home、End 和 Escape', async () => {
    render(<App />);
    const shortcut = await screen.findByRole('button', { name: '打开 常用网站' });
    fireEvent.contextMenu(shortcut);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '修改名称' }));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '修改域名' }));
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '删除' }));
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '修改名称' }));
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(shortcut);
  });

  it('设置面板限制 Tab 焦点，关闭后恢复到设置按钮', async () => {
    render(<App />);
    await screen.findByRole('button', { name: '打开 常用网站' });
    const trigger = screen.getByRole('button', { name: '打开设置' });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: '设置' });
    const close = within(dialog).getByRole('button', { name: '关闭设置' });
    await waitFor(() => expect(document.activeElement).toBe(close));
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '添加快捷方式' }));
    await userEvent.tab();
    expect(document.activeElement).toBe(close);
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(trigger);
  });

  it('关闭动画没有结束事件时仍卸载面板，重新打开时清空旧表单', async () => {
    render(<App />);
    await screen.findByRole('button', { name: '打开 常用网站' });
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: '打开设置' }));
      act(() => vi.advanceTimersByTime(32));
      const dialog = screen.getByRole('dialog', { name: '设置' });
      fireEvent.change(within(dialog).getByPlaceholderText('example.com'), { target: { value: 'unsaved.example' } });
      fireEvent.keyDown(document, { key: 'Escape' });
      act(() => vi.advanceTimersByTime(350));
      expect(document.querySelector('.settingsPanel')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '打开设置' }));
      act(() => vi.advanceTimersByTime(32));
      expect((within(screen.getByRole('dialog', { name: '设置' })).getByPlaceholderText('example.com') as HTMLInputElement).value).toBe('');
    } finally { cleanup(); vi.useRealTimers(); }
  });

  it('支持刷新加载失败的图标', async () => {
    render(<App />);
    const shortcut = await screen.findByRole('button', { name: '打开 常用网站' });
    fireEvent.error(shortcut.querySelector('img')!);
    expect(shortcut.querySelector('img')).toBeNull();
    fireEvent.contextMenu(shortcut);
    await userEvent.click(screen.getByRole('menuitem', { name: '刷新图标' }));
    expect(shortcut.querySelector('img')).toBeTruthy();
    expect(document.activeElement).toBe(shortcut);
  });

  it('支持上传自定义图标并切换回自动图标', async () => {
    render(<App />);
    const shortcut = await screen.findByRole('button', { name: '打开 常用网站' });
    fireEvent.contextMenu(shortcut);
    await userEvent.click(screen.getByRole('menuitem', { name: '修改图标' }));
    let dialog = screen.getByRole('dialog', { name: '修改图标' });
    await userEvent.click(within(dialog).getByRole('radio', { name: '上传自定义图标' }));
    await userEvent.upload(within(dialog).getByLabelText('图标文件'), new File(['image'], 'icon.png', { type: 'image/png' }));
    await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(stored.shortcuts[0]).toMatchObject({ iconMode: 'custom', customIconId: 'uploaded-icon' });
    fireEvent.contextMenu(shortcut);
    await userEvent.click(screen.getByRole('menuitem', { name: '修改图标' }));
    dialog = screen.getByRole('dialog', { name: '修改图标' });
    await userEvent.click(within(dialog).getByRole('radio', { name: '自动获取 favicon' }));
    await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(stored.shortcuts[0].iconMode).toBe('favicon');
    expect(stored.shortcuts[0].customIconId).toBeUndefined();
    expect(deleteCustomIcon).toHaveBeenCalledWith('uploaded-icon');
  });
});

afterEach(() => {
  cleanup();
  restoreLocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (getAnimationsDescriptor) Object.defineProperty(Element.prototype, 'getAnimations', getAnimationsDescriptor);
  else Reflect.deleteProperty(Element.prototype, 'getAnimations');
});

async function openUrlDialog() {
  const shortcut = await screen.findByRole('button', { name: '打开 常用网站' });
  fireEvent.contextMenu(shortcut, { clientX: window.innerWidth - 1, clientY: window.innerHeight - 1 });
  const menu = screen.getByRole('menu');
  expect(Number.parseFloat(menu.style.top) + 232).toBeLessThanOrEqual(window.innerHeight - 8);
  await userEvent.click(screen.getByRole('menuitem', { name: '修改域名' }));
  return screen.getByRole('dialog', { name: '修改域名' });
}

describe('快捷方式右键修改域名', () => {
  it('预填原地址，保存裸域名并持久化，保留其他属性且刷新失败过的网站图标', async () => {
    const original = { ...stored.shortcuts[0] };
    const view = render(<App />);
    const shortcut = await screen.findByRole('button', { name: '打开 常用网站' });
    fireEvent.error(shortcut.querySelector('img')!);
    expect(shortcut.querySelector('img')).toBeNull();
    const dialog = await openUrlDialog();
    const input = within(dialog).getByLabelText('域名或 URL') as HTMLInputElement;
    expect(input.value).toBe(original.url);
    await userEvent.clear(input);
    await userEvent.type(input, 'new.example/docs?q=2#intro');
    await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(stored.shortcuts).toEqual([{ ...original, url: 'https://new.example/docs?q=2#intro' }]);
    expect(shortcut.querySelector('img')?.getAttribute('src')).toContain(encodeURIComponent(stored.shortcuts[0].url));
    view.unmount();
    render(<App />);
    const reopened = await openUrlDialog();
    expect((within(reopened).getByLabelText('域名或 URL') as HTMLInputElement).value).toBe(stored.shortcuts[0].url);
  });

  it.each(['https://', 'javascript:alert(1)'])('无效地址 %s 显示错误且不保存', async (url) => {
    render(<App />);
    const dialog = await openUrlDialog();
    const input = within(dialog).getByLabelText('域名或 URL');
    await userEvent.clear(input);
    expect((within(dialog).getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(input, url);
    await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/URL 无效|URL 协议不允许/);
    expect(setStorage).not.toHaveBeenCalled();
    expect(stored.shortcuts[0].url).toBe('https://old.example/path?q=1');
  });

  it('保存失败保留输入供重试，支持完整 HTTP 地址', async () => {
    render(<App />);
    const dialog = await openUrlDialog();
    const input = within(dialog).getByLabelText('域名或 URL') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'http://new.example:8080/path');
    setStorage.mockRejectedValueOnce(new Error('storage failure'));
    await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('域名保存失败，请重试。');
    expect(input.value).toBe('http://new.example:8080/path');
    expect(stored.shortcuts[0].url).toBe('https://old.example/path?q=1');
    await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(stored.shortcuts[0].url).toBe('http://new.example:8080/path');
  });

  it('取消、Escape 和点击弹窗外部均关闭弹窗且不保存', async () => {
    render(<App />);
    let dialog = await openUrlDialog();
    await userEvent.clear(within(dialog).getByLabelText('域名或 URL'));
    await userEvent.type(within(dialog).getByLabelText('域名或 URL'), 'unsaved.example');
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    dialog = await openUrlDialog();
    expect((within(dialog).getByLabelText('域名或 URL') as HTMLInputElement).value).toBe(stored.shortcuts[0].url);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    dialog = await openUrlDialog();
    fireEvent.mouseDown(dialog.parentElement!);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(setStorage).not.toHaveBeenCalled();
  });
});
