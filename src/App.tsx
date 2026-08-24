import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { GRID_SLOTS, MAX_SHORTCUTS, SEARCH_PROVIDERS } from './constants';
import { ShortcutIcon } from './components/ShortcutIcon';
import { buildSearchUrl } from './lib/search';
import { firstEmptySlot, moveOrSwapShortcut, nameFromUrl, normalizeShortcutUrl, ShortcutValidationError } from './lib/shortcuts';
import { loadAppData, saveSearchProvider, saveShortcuts } from './storage/appStorage';
import { deleteCustomIcon, processCustomIcon, saveCustomIcon } from './storage/iconStore';
import { cleanupWallpaperFiles, deleteWallpaper, importWallpaper, loadWallpaperFile, WallpaperError } from './storage/wallpaperStore';
import type { IconMode, SearchProviderId, Shortcut, WallpaperMetadata, WallpaperType } from './types';

interface ContextState { shortcut: Shortcut; x: number; y: number }

function GearIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.7 7.7 0 0 0 0-2l2-1.55-2-3.46-2.47 1a7.5 7.5 0 0 0-1.73-1L14.82 3h-4l-.38 3a7.5 7.5 0 0 0-1.73 1l-2.47-1-2 3.46 2 1.55a7.7 7.7 0 0 0 0 2l-2 1.55 2 3.46 2.47-1a7.5 7.5 0 0 0 1.73 1l.38 3h4l.38-3a7.5 7.5 0 0 0 1.73-1l2.47 1 2-3.46L19.4 13ZM12.82 15.4a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" /></svg>;
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20.5 19-4.3-4.3a7 7 0 1 0-1.5 1.5l4.3 4.3 1.5-1.5ZM5.2 10.8a5.6 5.6 0 1 1 11.2 0 5.6 5.6 0 0 1-11.2 0Z" /></svg>;
}

function CheckIcon() {
  return (
    <svg className="checkIcon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m3.2 8.2 3.05 3.05L12.9 4.8" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DraggableShortcut({ shortcut, onContextMenu, onOpen }: {
  shortcut: Shortcut;
  onContextMenu: (event: MouseEvent, shortcut: Shortcut) => void;
  onOpen: (shortcut: Shortcut) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: shortcut.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <button
      ref={setNodeRef}
      className={`shortcut${isDragging ? ' dragging' : ''}`}
      style={style}
      title={shortcut.name}
      aria-label={`打开 ${shortcut.name}`}
      onClick={() => onOpen(shortcut)}
      onContextMenu={(event) => onContextMenu(event, shortcut)}
      {...listeners}
      {...attributes}
    >
      <span className="shortcutIcon"><ShortcutIcon shortcut={shortcut} /></span>
      <span className="shortcutName">{shortcut.name}</span>
    </button>
  );
}

function GridSlot({ slot, shortcut, onContextMenu, onOpen }: {
  slot: number;
  shortcut?: Shortcut;
  onContextMenu: (event: MouseEvent, shortcut: Shortcut) => void;
  onOpen: (shortcut: Shortcut) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot-${slot}`, data: { slot } });
  return (
    <div ref={setNodeRef} className={`gridSlot${isOver ? ' slotOver' : ''}`}>
      {shortcut && <DraggableShortcut shortcut={shortcut} onContextMenu={onContextMenu} onOpen={onOpen} />}
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [provider, setProvider] = useState<SearchProviderId>('bing');
  const [query, setQuery] = useState('');
  const [providerOpen, setProviderOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [wallpaper, setWallpaper] = useState<WallpaperMetadata | null>(null);
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextState | null>(null);
  const [renameTarget, setRenameTarget] = useState<Shortcut | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Shortcut | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const justDragged = useRef(false);
  const providerMenuRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }));

  const showError = useCallback((message: string) => {
    setError(message);
    setNotice(null);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3_800);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    loadAppData().then((data) => {
      setProvider(data.preferences.searchProvider);
      setShortcuts(data.shortcuts);
      setWallpaper(data.wallpaperMetadata);
      cleanupWallpaperFiles(data.wallpaperMetadata?.opfsFileName ?? null).catch(() => undefined);
      setReady(true);
    }).catch(() => {
      showError('本地设置读取失败，请重新打开新标签页。');
      setReady(true);
    });
  }, [showError]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setWallpaperUrl(null);
    if (wallpaper) {
      loadWallpaperFile(wallpaper).then((file) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(file);
        setWallpaperUrl(objectUrl);
      }).catch((reason: unknown) => active && showError(reason instanceof Error ? reason.message : '壁纸读取失败。'));
    }
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [wallpaper, showError]);

  useEffect(() => {
    const onVisibility = () => {
      const video = videoRef.current;
      if (!video) return;
      if (document.hidden) video.pause();
      else void video.play().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (providerOpen && !providerMenuRef.current?.contains(target)) setProviderOpen(false);
      if (contextMenu && !contextRef.current?.contains(target)) setContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setProviderOpen(false);
      setContextMenu(null);
      setRenameTarget(null);
      setDeleteTarget(null);
      setSettingsOpen(false);
    };
    const onBlur = () => setContextMenu(null);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
    };
  }, [contextMenu, providerOpen]);

  const shortcutBySlot = useMemo(() => new Map(shortcuts.map((item) => [item.slot, item])), [shortcuts]);
  const activeShortcut = activeId ? shortcuts.find((item) => item.id === activeId) : undefined;

  const search = () => {
    const url = buildSearchUrl(provider, query);
    if (url) window.location.assign(url);
  };

  const selectProvider = async (id: SearchProviderId) => {
    const previous = provider;
    setProvider(id);
    setProviderOpen(false);
    try {
      await saveSearchProvider(id);
    } catch {
      setProvider(previous);
      showError('搜索提供商保存失败。');
    }
  };

  const openShortcut = (shortcut: Shortcut) => {
    if (justDragged.current) return;
    window.location.assign(shortcut.url);
  };

  const onDragStart = (event: DragStartEvent) => {
    justDragged.current = true;
    setActiveId(String(event.active.id));
    setContextMenu(null);
  };

  const onDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    window.setTimeout(() => { justDragged.current = false; }, 120);
    const slot = event.over?.data.current?.slot;
    if (typeof slot !== 'number') return;
    const previous = shortcuts;
    const next = moveOrSwapShortcut(shortcuts, String(event.active.id), slot);
    if (next === previous) return;
    setShortcuts(next);
    try {
      await saveShortcuts(next);
    } catch {
      setShortcuts(previous);
      showError('快捷方式位置保存失败。');
    }
  };

  const openContextMenu = (event: MouseEvent, shortcut: Shortcut) => {
    event.preventDefault();
    const width = 170;
    const height = 104;
    setContextMenu({
      shortcut,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
    });
  };

  const renameShortcut = async (name: string) => {
    if (!renameTarget || !name.trim()) return;
    const next = shortcuts.map((item) => item.id === renameTarget.id ? { ...item, name: name.trim() } : item);
    try {
      await saveShortcuts(next);
      setShortcuts(next);
      setRenameTarget(null);
    } catch {
      showError('名称保存失败。');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const next = shortcuts.filter((item) => item.id !== deleteTarget.id);
    try {
      await saveShortcuts(next);
      setShortcuts(next);
      if (deleteTarget.customIconId && !next.some((item) => item.customIconId === deleteTarget.customIconId)) {
        await deleteCustomIcon(deleteTarget.customIconId).catch(() => undefined);
      }
      setDeleteTarget(null);
    } catch {
      showError('快捷方式删除失败。');
    }
  };

  const addShortcut = async (values: { name: string; url: string; mode: IconMode; iconFile: File | null }) => {
    if (shortcuts.length >= MAX_SHORTCUTS) throw new ShortcutValidationError('最多只能添加 24 个快捷方式。');
    const slot = firstEmptySlot(shortcuts);
    if (slot === null) throw new ShortcutValidationError('最多只能添加 24 个快捷方式。');
    const url = normalizeShortcutUrl(values.url);
    let customIconId: string | undefined;
    if (values.mode === 'custom') {
      if (!values.iconFile) throw new ShortcutValidationError('请选择自定义图标。');
      customIconId = await saveCustomIcon(await processCustomIcon(values.iconFile));
    }
    const shortcut: Shortcut = {
      id: crypto.randomUUID(),
      name: values.name.trim() || nameFromUrl(url),
      url,
      iconMode: values.mode,
      customIconId,
      slot,
      createdAt: Date.now(),
    };
    const next = [...shortcuts, shortcut];
    try {
      await saveShortcuts(next);
      setShortcuts(next);
      setNotice('快捷方式已添加。');
      setError(null);
    } catch (reason) {
      if (customIconId) await deleteCustomIcon(customIconId).catch(() => undefined);
      throw reason;
    }
  };

  const changeWallpaper = async (file: File, type: WallpaperType) => {
    try {
      const metadata = await importWallpaper(file, type, wallpaper);
      setWallpaper(metadata);
      setNotice('壁纸已更新。');
      setError(null);
    } catch (reason) {
      showError(reason instanceof WallpaperError ? reason.message : '壁纸保存失败，当前壁纸未改变。');
    }
  };

  const removeWallpaper = async () => {
    try {
      await deleteWallpaper(wallpaper);
      setWallpaper(null);
      setNotice('已恢复默认背景。');
      setError(null);
    } catch {
      showError('删除壁纸失败，请稍后重试。');
    }
  };

  return (
    <main className={`newTab${wallpaper ? '' : ' noWallpaper'}`}>
      <div className="wallpaperLayer">
        {wallpaperUrl && wallpaper?.type === 'image' && <img src={wallpaperUrl} alt="" />}
        {wallpaperUrl && wallpaper?.type === 'video' && (
          <video ref={videoRef} src={wallpaperUrl} autoPlay muted loop playsInline onCanPlay={() => void videoRef.current?.play().catch(() => undefined)} />
        )}
      </div>
      <div className="readabilityLayer" />

      <section className="content" aria-label="新标签页">
        <div className="searchWrap">
          <div className="providerWrap" ref={providerMenuRef}>
            <button className="providerButton" aria-label="选择搜索提供商" aria-expanded={providerOpen} onClick={() => setProviderOpen((open) => !open)}>
              <svg
                className={`providerChevron${providerOpen ? ' open' : ''}`}
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path d="M2.8 5.8 8 9.8l5.2-4" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {providerOpen && (
              <div className="providerMenu" role="menu">
                {SEARCH_PROVIDERS.map((item) => (
                  <button key={item.id} role="menuitemradio" aria-checked={provider === item.id} onClick={() => void selectProvider(item.id)}>
                    <span>{item.name}</span><span className="check">{provider === item.id && <CheckIcon />}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') search(); }}
            aria-label="搜索内容"
            placeholder={`使用 ${SEARCH_PROVIDERS.find((item) => item.id === provider)?.name} 搜索`}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="searchButton" aria-label="搜索" onClick={search}><SearchIcon /></button>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragCancel={() => { setActiveId(null); justDragged.current = false; }} onDragEnd={(event) => void onDragEnd(event)}>
          <div className="shortcutGrid" aria-label="快捷方式">
            {GRID_SLOTS.map((slot) => (
              <GridSlot key={slot} slot={slot} shortcut={shortcutBySlot.get(slot)} onContextMenu={openContextMenu} onOpen={openShortcut} />
            ))}
          </div>
          <DragOverlay>{activeShortcut ? <div className="shortcut dragOverlay"><span className="shortcutIcon"><ShortcutIcon shortcut={activeShortcut} /></span><span className="shortcutName">{activeShortcut.name}</span></div> : null}</DragOverlay>
        </DndContext>
      </section>

      <button className="settingsButton" aria-label="打开设置" onClick={() => setSettingsOpen(true)}><GearIcon /></button>
      {!ready && <div className="loading" role="status">正在加载…</div>}
      {(error || notice) && <div className={`toast ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{error ?? notice}<button aria-label="关闭提示" onClick={() => { setError(null); setNotice(null); }}>×</button></div>}

      {settingsOpen && (
        <div className="drawerBackdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <SettingsPanel
            wallpaper={wallpaper}
            shortcutCount={shortcuts.length}
            onClose={() => setSettingsOpen(false)}
            onAdd={addShortcut}
            onWallpaper={changeWallpaper}
            onDeleteWallpaper={removeWallpaper}
            onError={showError}
          />
        </div>
      )}

      {contextMenu && (
        <div ref={contextRef} className="contextMenu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu">
          <button role="menuitem" onClick={() => { setRenameTarget(contextMenu.shortcut); setContextMenu(null); }}>修改名称</button>
          <button role="menuitem" className="dangerText" onClick={() => { setDeleteTarget(contextMenu.shortcut); setContextMenu(null); }}>删除</button>
        </div>
      )}
      {renameTarget && <RenameDialog shortcut={renameTarget} onClose={() => setRenameTarget(null)} onSave={renameShortcut} />}
      {deleteTarget && <ConfirmDialog name={deleteTarget.name} onClose={() => setDeleteTarget(null)} onConfirm={() => void confirmDelete()} />}
    </main>
  );
}

function SettingsPanel({ wallpaper, shortcutCount, onClose, onAdd, onWallpaper, onDeleteWallpaper, onError }: {
  wallpaper: WallpaperMetadata | null;
  shortcutCount: number;
  onClose: () => void;
  onAdd: (values: { name: string; url: string; mode: IconMode; iconFile: File | null }) => Promise<void>;
  onWallpaper: (file: File, type: WallpaperType) => Promise<void>;
  onDeleteWallpaper: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<IconMode>('favicon');
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const iconInput = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
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
    await onWallpaper(file, type);
    setBusy(false);
  };

  return (
    <aside className="settingsPanel" aria-label="设置">
      <header><h2>设置</h2><button className="closeButton" aria-label="关闭设置" onClick={onClose}>×</button></header>
      <section>
        <h3>壁纸</h3>
        <p className="metadata">当前：{wallpaper ? `${wallpaper.type === 'image' ? '静态图片' : '动态视频'} · ${wallpaper.fileName}` : '默认背景'}</p>
        <div className="wallpaperActions">
          <label className={`actionButton ${busy ? 'disabled' : ''}`}>选择静态壁纸<input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" disabled={busy} onChange={selectWallpaper('image')} /></label>
          <label className={`actionButton ${busy ? 'disabled' : ''}`}>选择动态壁纸<input type="file" accept=".mp4,.webm,video/mp4,video/webm" disabled={busy} onChange={selectWallpaper('video')} /></label>
          <button className="secondaryButton" disabled={busy || !wallpaper} onClick={() => void onDeleteWallpaper()}>删除当前壁纸</button>
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
            <label className="radio"><input type="radio" name="iconMode" checked={mode === 'favicon'} onChange={() => setMode('favicon')} /> 自动获取 favicon</label>
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

function RenameDialog({ shortcut, onClose, onSave }: { shortcut: Shortcut; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(shortcut.name);
  return (
    <div className="modalBackdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="dialog" onSubmit={(event) => { event.preventDefault(); void onSave(name); }}>
        <h2>修改名称</h2>
        <label>名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></label>
        <div className="dialogActions"><button type="button" className="secondaryButton" onClick={onClose}>取消</button><button className="primaryButton" disabled={!name.trim()}>保存</button></div>
      </form>
    </div>
  );
}

function ConfirmDialog({ name, onClose, onConfirm }: { name: string; onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="modalBackdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
        <h2 id="delete-title">删除快捷方式？</h2><p>将删除“{name}”，原槽位会保持为空。</p>
        <div className="dialogActions"><button className="secondaryButton" onClick={onClose}>取消</button><button className="dangerButton" onClick={onConfirm}>删除</button></div>
      </div>
    </div>
  );
}
