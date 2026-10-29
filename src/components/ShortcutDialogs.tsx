import { useState, type FormEvent } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import type { IconMode, Shortcut } from '../types';

interface DialogProps { onClose: () => void; restoreTarget: HTMLElement | null }

export function ShortcutTextDialog({ shortcut, field, onClose, onSave, restoreTarget }: DialogProps & {
  shortcut: Shortcut; field: 'name' | 'url'; onSave: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(shortcut[field]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useFocusTrap<HTMLFormElement>(true, restoreTarget);
  const title = field === 'name' ? '修改名称' : '修改域名';
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !value.trim()) return;
    setBusy(true); setError(null);
    try { await onSave(value); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试。'); }
    finally { setBusy(false); }
  };
  return (
    <div className="modalBackdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <form ref={ref} tabIndex={-1} className="dialog" role="dialog" aria-modal="true" aria-labelledby="shortcut-dialog-title" onKeyDown={(event) => { if (event.key === 'Escape' && busy) event.stopPropagation(); }} onSubmit={(event) => void submit(event)}>
        <h2 id="shortcut-dialog-title">{title}</h2>
        <label>{field === 'name' ? '名称' : '域名或 URL'}<input autoFocus value={value} onChange={(event) => { setValue(event.target.value); setError(null); }} required maxLength={field === 'name' ? 80 : undefined} placeholder={field === 'url' ? 'example.com' : undefined} inputMode={field === 'url' ? 'url' : 'text'} autoComplete="off" spellCheck={false} disabled={busy} aria-invalid={!!error} aria-describedby={error ? 'shortcut-dialog-error' : undefined} /></label>
        {error && <p id="shortcut-dialog-error" className="inlineError" role="alert">{error}</p>}
        <div className="dialogActions"><button type="button" className="secondaryButton" onClick={onClose} disabled={busy}>取消</button><button className="primaryButton" disabled={busy || !value.trim()}>{busy ? '保存中…' : '保存'}</button></div>
      </form>
    </div>
  );
}

export function ShortcutIconDialog({ shortcut, onClose, onSave, restoreTarget }: DialogProps & {
  shortcut: Shortcut; onSave: (mode: IconMode, file: File | null) => Promise<void>;
}) {
  const [mode, setMode] = useState<IconMode>(shortcut.iconMode);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useFocusTrap<HTMLFormElement>(true, restoreTarget);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try { await onSave(mode, file); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '图标保存失败，请重试。'); }
    finally { setBusy(false); }
  };
  return (
    <div className="modalBackdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <form ref={ref} tabIndex={-1} className="dialog" role="dialog" aria-modal="true" aria-labelledby="icon-dialog-title" onKeyDown={(event) => { if (event.key === 'Escape' && busy) event.stopPropagation(); }} onSubmit={(event) => void submit(event)}>
        <h2 id="icon-dialog-title">修改图标</h2>
        <label className="radio"><input type="radio" name="editIconMode" checked={mode === 'favicon'} disabled={busy} onChange={() => { setMode('favicon'); setFile(null); setError(null); }} /> 自动获取 favicon</label>
        <label className="radio"><input type="radio" name="editIconMode" checked={mode === 'custom'} disabled={busy} onChange={() => setMode('custom')} /> 上传自定义图标</label>
        {mode === 'custom' && <label>图标文件<input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>}
        {mode === 'custom' && shortcut.customIconId && !file && <p className="hint">不选择文件时保留当前自定义图标。</p>}
        {error && <p className="inlineError" role="alert">{error}</p>}
        <div className="dialogActions"><button type="button" className="secondaryButton" onClick={onClose} disabled={busy}>取消</button><button className="primaryButton" disabled={busy}>{busy ? '保存中…' : '保存'}</button></div>
      </form>
    </div>
  );
}

export function ConfirmDialog({ name, onClose, onConfirm, restoreTarget }: DialogProps & { name: string; onConfirm: () => Promise<void> }) {
  const ref = useFocusTrap<HTMLDivElement>(true, restoreTarget);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await onConfirm(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '删除失败，请重试。'); }
    finally { setBusy(false); }
  };
  return (
    <div className="modalBackdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={ref} className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape' && busy) event.stopPropagation(); }}>
        <h2 id="delete-title">删除快捷方式？</h2><p>将删除“{name}”，原槽位会保持为空。</p>
        {error && <p className="inlineError" role="alert">{error}</p>}
        <div className="dialogActions"><button className="secondaryButton" onClick={onClose} disabled={busy}>取消</button><button className="dangerButton" onClick={() => void confirm()} disabled={busy}>{busy ? '删除中…' : '删除'}</button></div>
      </div>
    </div>
  );
}
