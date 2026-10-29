import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { GRID_COLUMNS, GRID_ROWS, SEARCH_DRAG_HOLD_MS, SEARCH_DRAG_TOLERANCE_PX, SEARCH_WIDGET_COLUMNS } from '../constants';
import { positionToSlot } from '../lib/layout';

interface SearchLayout { searchSlot: number }
interface Session {
  pointerId: number; timerId: number; activated: boolean;
  startX: number; startY: number; offsetX: number; offsetY: number;
  origin: SearchLayout; input: HTMLInputElement;
}

export function useSearchDrag({ searchSlot, query, providerOpen, gridRef, widgetRef, onSave, onError }: {
  searchSlot: number; query: string; providerOpen: boolean;
  gridRef: RefObject<HTMLDivElement | null>; widgetRef: RefObject<HTMLDivElement | null>;
  onSave: (slot: number) => Promise<void>; onError: (message: string) => void;
}) {
  const [preview, setPreview] = useState<SearchLayout | null>(null);
  const [holding, setHolding] = useState(false);
  const [dragging, setDragging] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  const previewRef = useRef<SearchLayout | null>(null);
  const suppressClick = useRef(false);
  const saving = useRef(false);

  const slotFromPointer = (clientX: number, clientY: number, session: Session) => {
    const grid = gridRef.current;
    if (!grid) return session.origin.searchSlot;
    const rect = grid.getBoundingClientRect();
    const computed = window.getComputedStyle(grid);
    const columnGap = Number.parseFloat(computed.columnGap) || 0;
    const rowGap = Number.parseFloat(computed.rowGap) || 0;
    const columnStep = (rect.width + columnGap) / GRID_COLUMNS;
    const rowStep = (rect.height + rowGap) / GRID_ROWS;
    const column = Math.max(0, Math.min(GRID_COLUMNS - SEARCH_WIDGET_COLUMNS, Math.round((clientX - session.offsetX - rect.left) / columnStep)));
    const row = Math.max(0, Math.min(GRID_ROWS - 1, Math.round((clientY - session.offsetY - rect.top) / rowStep)));
    return positionToSlot(column, row);
  };

  const cancel = useCallback(() => {
    const session = sessionRef.current;
    // A completed drop can still be saving. Cancel only an active gesture.
    if (!session) return;
    window.clearTimeout(session.timerId);
    if (session.input.hasPointerCapture(session.pointerId)) session.input.releasePointerCapture(session.pointerId);
    sessionRef.current = null; previewRef.current = null;
    setPreview(null); setHolding(false); setDragging(false);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('blur', cancel);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('blur', cancel);
      document.removeEventListener('keydown', onKey);
      if (sessionRef.current) window.clearTimeout(sessionRef.current.timerId);
    };
  }, [cancel]);

  const begin = (event: PointerEvent<HTMLInputElement>) => {
    if ((event.pointerType === 'mouse' && event.button !== 0) || query.length > 0 || providerOpen || dragging || saving.current) return;
    const widget = widgetRef.current;
    if (!widget) return;
    const rect = widget.getBoundingClientRect();
    const input = event.currentTarget;
    try { input.setPointerCapture(event.pointerId); } catch { return; }
    const session: Session = {
      pointerId: event.pointerId, timerId: 0, activated: false,
      startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
      origin: { searchSlot }, input,
    };
    sessionRef.current = session;
    setHolding(true);
    session.timerId = window.setTimeout(() => {
      if (sessionRef.current !== session) return;
      session.activated = true;
      previewRef.current = session.origin; setPreview(session.origin);
      setHolding(false); setDragging(true); input.blur();
    }, SEARCH_DRAG_HOLD_MS);
  };

  const move = (event: PointerEvent<HTMLInputElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (!session.activated) {
      if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) > SEARCH_DRAG_TOLERANCE_PX) cancel();
      return;
    }
    event.preventDefault();
    const slot = slotFromPointer(event.clientX, event.clientY, session);
    if (previewRef.current?.searchSlot === slot) return;
    const next = { searchSlot: slot };
    previewRef.current = next; setPreview(next);
  };

  const end = (event: PointerEvent<HTMLInputElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    window.clearTimeout(session.timerId);
    sessionRef.current = null;
    if (session.input.hasPointerCapture(session.pointerId)) session.input.releasePointerCapture(session.pointerId);
    setHolding(false); setDragging(false);
    if (!session.activated) return;
    event.preventDefault();
    const next = previewRef.current ?? session.origin;
    previewRef.current = null;
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 120);
    if (next.searchSlot === session.origin.searchSlot) { setPreview(null); return; }
    saving.current = true;
    void onSave(next.searchSlot).catch((error: unknown) => {
      onError(error instanceof Error ? error.message : '桌面布局保存失败，已恢复原位置。');
    }).finally(() => { saving.current = false; setPreview(null); });
  };

  return { preview, holding, dragging, suppressClick, begin, move, end, cancel };
}
