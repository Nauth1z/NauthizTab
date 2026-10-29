import { useEffect, useRef, useState } from 'react';
import { loadWallpaperFile } from '../storage/wallpaperStore';
import type { WallpaperMetadata } from '../types';

export function useWallpaper(metadata: WallpaperMetadata | null, onError: (message: string) => void) {
  const [url, setUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileName = metadata?.opfsFileName;
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setUrl(null);
    if (metadata) {
      void loadWallpaperFile(metadata).then((file) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(file); setUrl(objectUrl);
      }).catch((error: unknown) => {
        if (active) onError(error instanceof Error ? error.message : '壁纸读取失败。');
      });
    }
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    // OPFS filenames are immutable; unrelated settings must not restart videos.
  }, [fileName, onError]);

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
  return { url, videoRef };
}
