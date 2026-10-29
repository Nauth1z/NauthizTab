import { useRef, useState, type FormEvent, type TransitionEvent } from 'react';
import { MAX_SHORTCUTS } from '../constants';
import { useFocusTrap } from '../hooks/useFocusTrap';
import type { IconMode, WallpaperMetadata, WallpaperType } from '../types';

export function SettingsPanel({ open, restoreTarget, wallpaper, shortcutCount, onClose, onAdd, onWallpaper, onDeleteWallpaper, onError, onTransitionEnd }: {
  open: boolean;
  restoreTarget: HTMLElement | null;
  wallpaper: WallpaperMetadata | null;
  shortcutCount: number;
  onClose: () => void;
  onAdd: (values: { name: string; url: string; mode: IconMode; iconFile: File | null }) => Promise<void>;
  onWallpaper: (file: File, type: WallpaperType) => Promise<void>;
  onDeleteWallpaper: () => Promise<void>;
  onError: (message: string) => void;
  onTransitionEnd: (event: TransitionEvent<HTMLElement>) => void;
}) {
  const panelRef = useFocusTrap<HTMLElement>(open, restoreTarget);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<IconMode>('favicon');
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const iconInput = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError(null);
    try {
      await onAdd({ name, url, mode, iconFile });
      setName(''); setUrl(''); setMode('favicon'); setIconFile(null);
      if (iconInput.current) iconInput.current.value = '';
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '快捷方式添加失败。';
      setFormError(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  };

  const selectWallpaper = (type: WallpaperType) => async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try { await onWallpaper(file, type); } finally { setBusy(false); }
  };

  return (
    <aside ref={panelRef} tabIndex={-1} id="settings-panel" className="settingsPanel" role="dialog" aria-modal="true" aria-label="设置" onTransitionEnd={onTransitionEnd}>
      <header><h2>设置</h2><button className="closeButton" aria-label="关闭设置" onClick={onClose}>×</button></header>
      <section>
        <h3>壁纸</h3>
        <p className="metadata">当前：{wallpaper ? `${wallpaper.type === 'image' ? '静态图片' : '动态视频'} · ${wallpaper.fileName}` : '默认背景'}</p>
        <div className="wallpaperActions">
          <label className={`actionButton ${busy ? 'disabled' : ''}`}>选择静态壁纸<input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" disabled={busy} onChange={selectWallpaper('image')} /></label>
          <label className={`actionButton ${busy ? 'disabled' : ''}`}>选择动态壁纸<input type="file" accept=".mp4,.webm,video/mp4,video/webm" disabled={busy} onChange={selectWallpaper('video')} /></label>
          <button className="secondaryButton" disabled={busy || !wallpaper} onClick={() => { setBusy(true); void onDeleteWallpaper().finally(() => setBusy(false)); }}>删除当前壁纸</button>
        </div>
        <p className="hint">图片最大 30 MB；视频最大 200 MB。文件只保存在本机。</p>
      </section>
      <section>
        <div className="sectionTitle"><h3>添加快捷方式</h3><span>{shortcutCount}/{MAX_SHORTCUTS}</span></div>
        {shortcutCount >= MAX_SHORTCUTS && <p className="inlineError">最多只能添加 24 个快捷方式。</p>}
        <form onSubmit={(event) => void submit(event)}>
          <label>名称（可选）<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="留空时使用域名" /></label>
          <label>URL<input value={url} onChange={(event) => setUrl(event.target.value)} required placeholder="example.com" inputMode="url" /></label>
          <fieldset>
            <legend>图标</legend>
            <label className="radio"><input type="radio" name="iconMode" checked={mode === 'favicon'} onChange={() => { setMode('favicon'); setIconFile(null); }} /> 自动获取 favicon</label>
            <label className="radio"><input type="radio" name="iconMode" checked={mode === 'custom'} onChange={() => setMode('custom')} /> 上传自定义图标</label>
          </fieldset>
          {mode === 'custom' && <label>图标文件<input ref={iconInput} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={(event) => setIconFile(event.target.files?.[0] ?? null)} /></label>}
          {formError && <p className="inlineError" role="alert">{formError}</p>}
          <button className="primaryButton" type="submit" disabled={busy || shortcutCount >= MAX_SHORTCUTS}>{busy ? '处理中…' : '添加快捷方式'}</button>
        </form>
      </section>
    </aside>
  );
}
