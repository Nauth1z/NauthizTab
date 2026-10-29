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
  type DropAnimation,
} from '@dnd-kit/core';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import {
  GRID_ROWS,
  GRID_SLOTS,
  SEARCH_PROVIDERS,
  SEARCH_WIDGET_COLUMNS,
} from './constants';
import { ShortcutIcon } from './components/ShortcutIcon';
import { SettingsPanel } from './components/SettingsPanel';
import { ConfirmDialog, ShortcutIconDialog, ShortcutTextDialog } from './components/ShortcutDialogs';
import { useAppData } from './hooks/useAppData';
import { useWallpaper } from './hooks/useWallpaper';
import { useSearchDrag } from './hooks/useSearchDrag';
import { useShortcutMoves } from './hooks/useShortcutMoves';
import { useMenuNavigation } from './hooks/useMenuNavigation';
import { reflowShortcutsForSearch, searchWidgetSlots, slotToPosition } from './lib/layout';
import { buildSearchUrl } from './lib/search';
import { nameFromUrl, normalizeShortcutUrl, ShortcutValidationError } from './lib/shortcuts';
import { addStoredShortcut, removeStoredShortcut, saveSearchLayout, saveSearchProvider, updateStoredShortcut, updateStoredShortcutIcon } from './storage/appStorage';
import { deleteCustomIcon, processCustomIcon, saveCustomIcon } from './storage/iconStore';
import { cleanupWallpaperFiles, deleteWallpaper, importWallpaper, WallpaperError } from './storage/wallpaperStore';
import type { IconMode, SearchProviderId, Shortcut, WallpaperType } from './types';

interface ContextState { shortcut: Shortcut; x: number; y: number }
const shortcutDropAnimation: DropAnimation = {
  duration: 220,
  easing: 'cubic-bezier(.2, .72, .2, 1)',
  sideEffects: ({ active, dragOverlay }) => {
    const activeOpacity = active.node.style.opacity;
    const overlayOpacity = dragOverlay.node.style.opacity;
    active.node.style.opacity = '0';
    dragOverlay.node.style.opacity = '1';

    return () => {
      dragOverlay.node.style.opacity = overlayOpacity;
      window.requestAnimationFrame(() => {
        if (active.node.style.opacity === '0') active.node.style.opacity = activeOpacity;
      });
    };
  },
};

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

function DraggableShortcut({ shortcut, refreshKey, onContextMenu, onOpen }: {
  shortcut: Shortcut;
  refreshKey: number;
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
      <span className="shortcutIcon"><ShortcutIcon shortcut={shortcut} refreshKey={refreshKey} /></span>
      <span className="shortcutName">{shortcut.name}</span>
    </button>
  );
}

function gridPlacement(slot: number, columnSpan = 1): CSSProperties {
  const { column, row } = slotToPosition(slot);
  return { gridColumn: `${column + 1} / span ${columnSpan}`, gridRow: row + 1 };
}

function useGridMoveAnimation(slot: number, skipAnimation = false, duration = 260) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const previousRect = useRef<DOMRect | null>(null);

  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    node.getAnimations().forEach((animation) => animation.cancel());
    const nextRect = node.getBoundingClientRect();
    const previous = previousRect.current;
    previousRect.current = nextRect;
    if (!previous || skipAnimation || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const x = previous.left - nextRect.left;
    const y = previous.top - nextRect.top;
    if (Math.abs(x) < 1 && Math.abs(y) < 1) return;
    node.animate(
      [{ transform: `translate3d(${x}px, ${y}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
      { duration, easing: 'cubic-bezier(.2, .72, .2, 1)' },
    );
  }, [duration, skipAnimation, slot]);

  return nodeRef;
}

function PositionedShortcut({ shortcut, refreshKey, skipLayoutAnimation, onContextMenu, onOpen }: {
  shortcut: Shortcut;
  refreshKey: number;
  skipLayoutAnimation: boolean;
  onContextMenu: (event: MouseEvent, shortcut: Shortcut) => void;
  onOpen: (shortcut: Shortcut) => void;
}) {
  const layoutRef = useGridMoveAnimation(shortcut.slot, skipLayoutAnimation);
  return (
    <div ref={layoutRef} className="shortcutPosition" style={gridPlacement(shortcut.slot)}>
      <DraggableShortcut shortcut={shortcut} refreshKey={refreshKey} onContextMenu={onContextMenu} onOpen={onOpen} />
    </div>
  );
}

function GridSlot({ slot, reserved }: {
  slot: number;
  reserved: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot-${slot}`, data: { slot } });
  return (
    <div
      ref={setNodeRef}
      className={`gridSlot${isOver ? ' slotOver' : ''}${reserved ? ' reserved' : ''}`}
      style={gridPlacement(slot)}
    />
  );
}

export default function App() {
  const [query, setQuery] = useState('');
  const [providerOpen, setProviderOpen] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<{ id: SearchProviderId } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsMounted, setSettingsMounted] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settlingShortcutId, setSettlingShortcutId] = useState<string | null>(null);
  const [gridLift, setGridLift] = useState(0);
  const [contextMenu, setContextMenu] = useState<ContextState | null>(null);
  const [renameTarget, setRenameTarget] = useState<Shortcut | null>(null);
  const [urlTarget, setUrlTarget] = useState<Shortcut | null>(null);
  const [iconTarget, setIconTarget] = useState<Shortcut | null>(null);
  const [iconRefresh, setIconRefresh] = useState<Record<string, number>>({});
  const [deleteTarget, setDeleteTarget] = useState<Shortcut | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const justDragged = useRef(false);
  const desktopGridRef = useRef<HTMLDivElement>(null);
  const gridLiftRef = useRef(0);
  const searchWidgetRef = useRef<HTMLDivElement>(null);
  const providerMenuRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLDivElement>(null);
  const contextTrigger = useRef<HTMLElement | null>(null);
  const providerListRef = useRef<HTMLDivElement>(null);
  const providerTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsFrameRef = useRef<number | null>(null);
  const settingsCloseTimerRef = useRef<number | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }));

  useLayoutEffect(() => {
    const grid = desktopGridRef.current;
    if (!grid) return;
    const updateLift = () => {
      const rect = grid.getBoundingClientRect();
      const rowGap = Number.parseFloat(window.getComputedStyle(grid).rowGap) || 0;
      const rowHeight = (rect.height - rowGap * (GRID_ROWS - 1)) / GRID_ROWS;
      const naturalTop = rect.top + gridLiftRef.current;
      const nextLift = Math.round(Math.max(0, Math.min(rowHeight + rowGap, naturalTop - 12)));
      if (Math.abs(nextLift - gridLiftRef.current) < 1) return;
      gridLiftRef.current = nextLift;
      setGridLift(nextLift);
    };
    updateLift();
    const resizeObserver = new ResizeObserver(updateLift);
    resizeObserver.observe(grid);
    window.addEventListener('resize', updateLift);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateLift);
    };
  }, []);

  const showError = useCallback((message: string) => {
    setError(message);
    setNotice(null);
  }, []);

  const { data, ready, applyData } = useAppData(showError);
  const { preferences: { searchProvider: savedProvider }, shortcuts, layout: { searchSlot }, wallpaperMetadata: wallpaper } = data;
  const provider = pendingProvider?.id ?? savedProvider;
  const shortcutMoves = useShortcutMoves(shortcuts, searchSlot, applyData, showError);
  const { url: wallpaperUrl, videoRef } = useWallpaper(wallpaper, showError);
  const {
    preview: searchPreview, holding: searchHolding, dragging: searchDragging,
    suppressClick: suppressSearchClick, begin: beginSearchHold, move: moveSearchPointer,
    end: endSearchPointer, cancel: cancelSearchPointer,
  } = useSearchDrag({ searchSlot, query, providerOpen, gridRef: desktopGridRef, widgetRef: searchWidgetRef,
    onSave: async (slot) => { applyData(await saveSearchLayout(slot)); }, onError: showError });
  useMenuNavigation(contextRef, !!contextMenu);
  useMenuNavigation(providerListRef, providerOpen);

  const closeSettings = useCallback(() => {
    if (settingsCloseTimerRef.current !== null) window.clearTimeout(settingsCloseTimerRef.current);
    if (settingsFrameRef.current !== null) {
      window.cancelAnimationFrame(settingsFrameRef.current);
      settingsFrameRef.current = null;
      setSettingsMounted(false);
    }
    setSettingsOpen(false);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setSettingsMounted(false);
      settingsCloseTimerRef.current = null;
    } else {
      // Interrupted or skipped CSS transitions may never emit transitionend.
      settingsCloseTimerRef.current = window.setTimeout(() => {
        settingsCloseTimerRef.current = null;
        setSettingsMounted(false);
      }, 320);
    }
  }, []);

  const openSettings = useCallback(() => {
    if (settingsCloseTimerRef.current !== null) {
      window.clearTimeout(settingsCloseTimerRef.current);
      settingsCloseTimerRef.current = null;
    }
    if (settingsMounted) setSettingsOpen(true);
    else setSettingsMounted(true);
  }, [settingsMounted]);

  useEffect(() => () => {
    if (settingsCloseTimerRef.current !== null) window.clearTimeout(settingsCloseTimerRef.current);
  }, []);

  useEffect(() => {
    if (!settingsMounted) return;
    settingsFrameRef.current = window.requestAnimationFrame(() => {
      settingsFrameRef.current = null;
      setSettingsOpen(true);
    });
    return () => {
      if (settingsFrameRef.current !== null) window.cancelAnimationFrame(settingsFrameRef.current);
      settingsFrameRef.current = null;
    };
  }, [settingsMounted]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3_800);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (ready) void cleanupWallpaperFiles().catch(() => undefined);
  }, [ready]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (providerOpen && !providerMenuRef.current?.contains(target)) setProviderOpen(false);
      if (contextMenu && !contextRef.current?.contains(target)) setContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      if (renameTarget || urlTarget || iconTarget || deleteTarget) {
        setRenameTarget(null); setUrlTarget(null); setIconTarget(null); setDeleteTarget(null);
        return;
      }
      if (contextMenu) { setContextMenu(null); contextTrigger.current?.focus(); return; }
      if (providerOpen) { setProviderOpen(false); providerTriggerRef.current?.focus(); return; }
      closeSettings();
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
  }, [closeSettings, contextMenu, providerOpen, renameTarget, urlTarget, iconTarget, deleteTarget]);

  const visibleSearchSlot = searchPreview?.searchSlot ?? searchSlot;
  const visibleShortcuts = useMemo(
    () => reflowShortcutsForSearch(shortcutMoves.shortcuts, visibleSearchSlot), [shortcutMoves.shortcuts, visibleSearchSlot],
  );
  const reservedSearchSlots = useMemo(() => new Set(searchWidgetSlots(visibleSearchSlot)), [visibleSearchSlot]);
  const activeShortcut = activeId ? visibleShortcuts.find((item) => item.id === activeId) : undefined;
  const searchMoveAnimationRef = useGridMoveAnimation(visibleSearchSlot, false, 170);
  const setSearchWidgetNode = useCallback((node: HTMLDivElement | null) => {
    searchWidgetRef.current = node;
    searchMoveAnimationRef.current = node;
  }, [searchMoveAnimationRef]);

  const search = () => {
    const url = buildSearchUrl(provider, query);
    if (url) window.location.assign(url);
  };

  const selectProvider = async (id: SearchProviderId) => {
    const selection = { id };
    setPendingProvider(selection);
    setProviderOpen(false);
    providerTriggerRef.current?.focus();
    try { applyData(await saveSearchProvider(id)); }
    catch { showError('搜索提供商保存失败。'); }
    finally { setPendingProvider((current) => current === selection ? null : current); }
  };

  const openShortcut = (shortcut: Shortcut) => {
    if (justDragged.current) return;
    window.location.assign(shortcut.url);
  };

  const onDragStart = (event: DragStartEvent) => {
    justDragged.current = true;
    setSettlingShortcutId(null);
    setActiveId(String(event.active.id));
    setContextMenu(null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    window.setTimeout(() => { justDragged.current = false; }, 120);
    const slot = event.over?.data.current?.slot;
    if (typeof slot !== 'number') return;
    if (!shortcutMoves.move(String(event.active.id), slot, visibleSearchSlot)) return;
    setSettlingShortcutId(String(event.active.id));
    window.requestAnimationFrame(() => setSettlingShortcutId(null));
  };

  const openContextMenu = (event: MouseEvent, shortcut: Shortcut) => {
    event.preventDefault();
    contextTrigger.current = event.currentTarget as HTMLElement;
    const width = 170;
    const height = 232;
    setContextMenu({
      shortcut,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
    });
  };

  const renameShortcut = async (name: string) => {
    if (!renameTarget || !name.trim()) return;
    applyData(await updateStoredShortcut(renameTarget.id, { name: name.trim() }));
    setRenameTarget(null);
  };

  const updateShortcutUrl = async (input: string) => {
    if (!urlTarget) return;
    const url = normalizeShortcutUrl(input);
    try { applyData(await updateStoredShortcut(urlTarget.id, { url })); }
    catch { throw new Error('域名保存失败，请重试。'); }
    setUrlTarget(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const next = await removeStoredShortcut(deleteTarget.id);
    applyData(next);
    setDeleteTarget(null);
  };

  const updateShortcutIcon = async (mode: IconMode, file: File | null) => {
    if (!iconTarget) return;
    const customIconId = mode === 'custom' && file ? await saveCustomIcon(await processCustomIcon(file)) : undefined;
    try {
      applyData(await updateStoredShortcutIcon(iconTarget.id, mode, customIconId));
    } catch (error) {
      if (file && customIconId) await deleteCustomIcon(customIconId).catch(() => undefined);
      throw error;
    }
    setIconTarget(null);
  };

  const addShortcut = async (values: { name: string; url: string; mode: IconMode; iconFile: File | null }) => {
    const url = normalizeShortcutUrl(values.url);
    let customIconId: string | undefined;
    if (values.mode === 'custom') {
      if (!values.iconFile) throw new ShortcutValidationError('请选择自定义图标。');
      customIconId = await saveCustomIcon(await processCustomIcon(values.iconFile));
    }
    const shortcut: Omit<Shortcut, 'slot'> = {
      id: crypto.randomUUID(),
      name: values.name.trim() || nameFromUrl(url),
      url,
      iconMode: values.mode,
      customIconId,
      createdAt: Date.now(),
    };
    try {
      applyData(await addStoredShortcut(shortcut));
      setNotice('快捷方式已添加。');
      setError(null);
    } catch (reason) {
      if (customIconId) await deleteCustomIcon(customIconId).catch(() => undefined);
      throw reason;
    }
  };

  const changeWallpaper = async (file: File, type: WallpaperType) => {
    try {
      applyData(await importWallpaper(file, type));
      setNotice('壁纸已更新。');
      setError(null);
    } catch (reason) {
      showError(reason instanceof WallpaperError ? reason.message : '壁纸保存失败，当前壁纸未改变。');
    }
  };

  const removeWallpaper = async () => {
    try {
      applyData(await deleteWallpaper());
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
          <video ref={videoRef} src={wallpaperUrl} autoPlay muted loop playsInline onCanPlay={() => { if (!document.hidden) void videoRef.current?.play().catch(() => undefined); }} />
        )}
      </div>
      <div className="readabilityLayer" />

      <section className="content" aria-label="新标签页">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragCancel={() => { setActiveId(null); justDragged.current = false; }} onDragEnd={(event) => void onDragEnd(event)}>
          <div
            ref={desktopGridRef}
            className={`desktopGrid${activeId || searchDragging ? ' layoutDragging' : ''}`}
            style={{ transform: `translateY(-${gridLift}px)` }}
            aria-label="桌面布局"
          >
            {GRID_SLOTS.map((slot) => (
              <GridSlot key={slot} slot={slot} reserved={reservedSearchSlots.has(slot)} />
            ))}
            {visibleShortcuts.map((shortcut) => (
              <PositionedShortcut
                key={shortcut.id}
                shortcut={shortcut}
                refreshKey={iconRefresh[shortcut.id] ?? 0}
                skipLayoutAnimation={shortcut.id === settlingShortcutId}
                onContextMenu={openContextMenu}
                onOpen={openShortcut}
              />
            ))}
            <div
              ref={setSearchWidgetNode}
              className={`searchWidget${searchHolding ? ' holding' : ''}${searchDragging ? ' dragging' : ''}${query.length === 0 && !providerOpen ? ' canDrag' : ''}${slotToPosition(visibleSearchSlot).row >= 4 ? ' opensUp' : ''}`}
              style={gridPlacement(visibleSearchSlot, SEARCH_WIDGET_COLUMNS)}
            >
              <div className="searchWrap">
                <div className="providerWrap" ref={providerMenuRef}>
                  <button ref={providerTriggerRef} className="providerButton" aria-label="选择搜索提供商" aria-expanded={providerOpen} onClick={() => setProviderOpen((open) => !open)}>
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
                    <div ref={providerListRef} className="providerMenu" role="menu">
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
                  onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) search(); }}
                  onPointerDown={beginSearchHold}
                  onPointerMove={moveSearchPointer}
                  onPointerUp={endSearchPointer}
                  onPointerCancel={cancelSearchPointer}
                  onClick={(event) => {
                    if (!suppressSearchClick.current) return;
                    event.preventDefault();
                    event.currentTarget.blur();
                  }}
                  onContextMenu={(event) => { if (searchHolding || searchDragging) event.preventDefault(); }}
                  aria-label="搜索内容"
                  aria-description="输入框为空且搜索提供商菜单关闭时，长按可拖动搜索框"
                  placeholder={`使用 ${SEARCH_PROVIDERS.find((item) => item.id === provider)?.name} 搜索`}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button className="searchButton" aria-label="搜索" onClick={search}><SearchIcon /></button>
              </div>
            </div>
          </div>
          <DragOverlay dropAnimation={shortcutDropAnimation}>{activeShortcut ? <div className="shortcut dragOverlay"><span className="shortcutIcon"><ShortcutIcon shortcut={activeShortcut} /></span><span className="shortcutName">{activeShortcut.name}</span></div> : null}</DragOverlay>
        </DndContext>
      </section>

      <button
        ref={settingsTriggerRef}
        data-focus-fallback
        className={`settingsButton${settingsOpen ? ' open' : ''}`}
        aria-label={settingsOpen ? '关闭设置' : '打开设置'}
        aria-expanded={settingsOpen}
        aria-controls="settings-panel"
        onClick={settingsOpen ? closeSettings : openSettings}
      ><GearIcon /></button>
      {!ready && <div className="loading" role="status">正在加载…</div>}
      {(error || notice) && <div className={`toast ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{error ?? notice}<button aria-label="关闭提示" onClick={() => { setError(null); setNotice(null); }}>×</button></div>}

      {settingsMounted && (
        <div
          className={`drawerBackdrop${settingsOpen ? ' open' : ''}`}
          aria-hidden={!settingsOpen}
          inert={!settingsOpen}
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeSettings(); }}
        >
          <SettingsPanel
            open={settingsOpen}
            restoreTarget={settingsTriggerRef.current}
            wallpaper={wallpaper}
            shortcutCount={shortcuts.length}
            onClose={closeSettings}
            onAdd={addShortcut}
            onWallpaper={changeWallpaper}
            onDeleteWallpaper={removeWallpaper}
            onError={showError}
            onTransitionEnd={(event) => {
              if (!settingsOpen && event.target === event.currentTarget && event.propertyName === 'transform') {
                if (settingsCloseTimerRef.current !== null) window.clearTimeout(settingsCloseTimerRef.current);
                settingsCloseTimerRef.current = null;
                setSettingsMounted(false);
              }
            }}
          />
        </div>
      )}

      {contextMenu && (
        <div ref={contextRef} className="contextMenu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu">
          <button role="menuitem" onClick={() => { setRenameTarget(contextMenu.shortcut); setContextMenu(null); }}>修改名称</button>
          <button role="menuitem" onClick={() => { setUrlTarget(contextMenu.shortcut); setContextMenu(null); }}>修改域名</button>
          <button role="menuitem" onClick={() => { setIconTarget(contextMenu.shortcut); setContextMenu(null); }}>修改图标</button>
          <button role="menuitem" onClick={() => { const id = contextMenu.shortcut.id; setIconRefresh((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 })); setContextMenu(null); contextTrigger.current?.focus(); }}>刷新图标</button>
          <button role="menuitem" className="dangerText" onClick={() => { setDeleteTarget(contextMenu.shortcut); setContextMenu(null); }}>删除</button>
        </div>
      )}
      {renameTarget && <ShortcutTextDialog field="name" restoreTarget={contextTrigger.current} shortcut={renameTarget} onClose={() => setRenameTarget(null)} onSave={renameShortcut} />}
      {urlTarget && <ShortcutTextDialog field="url" restoreTarget={contextTrigger.current} shortcut={urlTarget} onClose={() => setUrlTarget(null)} onSave={updateShortcutUrl} />}
      {iconTarget && <ShortcutIconDialog shortcut={iconTarget} restoreTarget={contextTrigger.current} onClose={() => setIconTarget(null)} onSave={updateShortcutIcon} />}
      {deleteTarget && <ConfirmDialog restoreTarget={contextTrigger.current} name={deleteTarget.name} onClose={() => setDeleteTarget(null)} onConfirm={confirmDelete} />}
    </main>
  );
}
