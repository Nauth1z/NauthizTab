import { CUSTOM_ICON_MIMES } from '../constants';

const DB_NAME = 'nauthiz-tab-icons';
const STORE_NAME = 'icons';
const DB_VERSION = 1;

export class IconError extends Error {}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestDone(request: IDBRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function processCustomIcon(file: File): Promise<Blob> {
  if (!CUSTOM_ICON_MIMES.has(file.type)) throw new IconError('自定义图标格式不支持，请选择 JPG、PNG 或 WebP。');
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas unavailable');
    const size = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - size) / 2;
    const sy = (bitmap.height - size) / 2;
    context.drawImage(bitmap, sx, sy, size, size, 0, 0, 128, 128);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88));
    if (!blob) throw new Error('encode failed');
    return blob;
  } catch (error) {
    if (error instanceof IconError) throw error;
    throw new IconError('自定义图标无法读取或处理。');
  }
}

export async function saveCustomIcon(blob: Blob): Promise<string> {
  const id = crypto.randomUUID();
  try {
    const db = await openDb();
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(blob, id);
    await requestDone(request);
    db.close();
    return id;
  } catch {
    throw new IconError('自定义图标保存失败，快捷方式未添加。');
  }
}

export async function getCustomIcon(id: string): Promise<Blob | null> {
  const db = await openDb();
  return new Promise((resolve) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
    request.onsuccess = () => {
      resolve(request.result instanceof Blob ? request.result : null);
      db.close();
    };
    request.onerror = () => {
      resolve(null);
      db.close();
    };
  });
}

export async function deleteCustomIcon(id: string): Promise<void> {
  const db = await openDb();
  const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id);
  await requestDone(request);
  db.close();
}
