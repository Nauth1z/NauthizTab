import { useEffect, useMemo, useState } from 'react';
import type { Shortcut } from '../types';
import { getCustomIcon } from '../storage/iconStore';

interface Props {
  shortcut: Shortcut;
}

export function ShortcutIcon({ shortcut }: Props) {
  const [customUrl, setCustomUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const faviconUrl = useMemo(() => {
    if (!chrome.runtime?.id) return '';
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
  }, [shortcut.customIconId, shortcut.iconMode]);

  const src = shortcut.iconMode === 'custom' ? customUrl : faviconUrl;
  if (!src || failed) return <span className="letterIcon" aria-hidden="true">{shortcut.name.trim().charAt(0).toUpperCase() || '?'}</span>;
  return <img className="shortcutImage" src={src} alt="" draggable={false} onError={() => setFailed(true)} />;
}
