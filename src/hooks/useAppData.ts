import { useCallback, useEffect, useState } from 'react';
import { loadAppData, migrateAppData, subscribeAppData } from '../storage/appStorage';
import type { AppData } from '../types';

export function useAppData(onError: (message: string) => void) {
  const [data, setData] = useState(() => migrateAppData(undefined));
  const [ready, setReady] = useState(false);
  const applyData = useCallback((next: AppData) => {
    setData((current) => (next.revision ?? 0) >= (current.revision ?? 0) ? next : current);
  }, []);

  useEffect(() => {
    let active = true;
    const fail = (error: unknown) => {
      if (active) onError(error instanceof Error ? error.message : '本地设置读取失败，请重新打开新标签页。');
    };
    const unsubscribe = subscribeAppData((next) => { if (active) applyData(next); }, fail);
    void loadAppData().then((next) => { if (active) applyData(next); }).catch(fail).finally(() => {
      if (active) setReady(true);
    });
    return () => { active = false; unsubscribe(); };
  }, [applyData, onError]);

  return { data, ready, applyData };
}
