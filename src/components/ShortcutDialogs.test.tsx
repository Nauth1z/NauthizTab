import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ShortcutIconDialog } from './ShortcutDialogs';
import { SettingsPanel } from './SettingsPanel';
import type { Shortcut } from '../types';

afterEach(cleanup);
const shortcut: Shortcut = { id: 'a', name: 'A', url: 'https://a.example/', iconMode: 'favicon', slot: 0, createdAt: 1 };

async function selectThenDiscardFile() {
  const file = new File(['png'], 'previous.png', { type: 'image/png' });
  await userEvent.click(screen.getByRole('radio', { name: '上传自定义图标' }));
  await userEvent.upload(screen.getByLabelText('图标文件'), file);
  await userEvent.click(screen.getByRole('radio', { name: '自动获取 favicon' }));
  await userEvent.click(screen.getByRole('radio', { name: '上传自定义图标' }));
  expect((screen.getByLabelText('图标文件') as HTMLInputElement).files).toHaveLength(0);
}

it('图标编辑切换模式后不提交已从文件框中消失的旧文件', async () => {
  const save = vi.fn(async () => {});
  render(<ShortcutIconDialog shortcut={shortcut} restoreTarget={null} onClose={() => {}} onSave={save} />);
  await selectThenDiscardFile();
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(save).toHaveBeenCalledWith('custom', null);
});

it('添加快捷方式切换图标模式后同样清理旧文件', async () => {
  const add = vi.fn(async () => {});
  render(<SettingsPanel open restoreTarget={null} wallpaper={null} shortcutCount={0} onClose={() => {}} onAdd={add} onWallpaper={async () => {}} onDeleteWallpaper={async () => {}} onError={() => {}} onTransitionEnd={() => {}} />);
  await userEvent.type(screen.getByLabelText('URL'), 'example.com');
  await selectThenDiscardFile();
  await userEvent.click(screen.getByRole('button', { name: '添加快捷方式' }));
  expect(add).toHaveBeenCalledWith({ name: '', url: 'example.com', mode: 'custom', iconFile: null });
});
