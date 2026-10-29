import { useEffect, useMemo, useState } from 'react';
import type { Shortcut } from '../types';
import { getCustomIcon } from '../storage/iconStore';

interface Props {
  shortcut: Shortcut;
  refreshKey?: number;
}

export function ShortcutIcon({ shortcut, refreshKey = 0 }: Props) {
  const [customUrl, setCustomUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const faviconUrl = useMemo(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) return '';
    return chrome.runtime.getURL(`_favicon/?pageUrl=${encodeURIComponent(shortcut.url)}&size=64`);
  }, [shortcut.url]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setFailed(false);
    setCustomUrl(null);
    if (shortcut.iconMode === 'custom' && shortcut.customIconId) {
      getCustomIcon(shortcut.customIconId).then((blob) => {
        if (!active || !blob) {
          if (active) setFailed(true);
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setCustomUrl(objectUrl);
      }).catch(() => active && setFailed(true));
    }
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [shortcut.customIconId, shortcut.iconMode, refreshKey]);

  useEffect(() => {
    if (shortcut.iconMode === 'favicon') setFailed(false);
  }, [faviconUrl, shortcut.iconMode, refreshKey]);

  const src = shortcut.iconMode === 'custom' ? customUrl : faviconUrl;
  if (!src || failed) return <span className="letterIcon" aria-hidden="true" title="图标不可用，可右键刷新图标或修改图标">{shortcut.name.trim().charAt(0).toUpperCase() || '?'}</span>;
  return <img key={refreshKey} className="shortcutImage" src={src} alt="" draggable={false} onError={() => setFailed(true)} />;
}
