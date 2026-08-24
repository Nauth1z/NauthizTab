import {
  IMAGE_WALLPAPER_MAX_BYTES,
  IMAGE_WALLPAPER_MIMES,
  VIDEO_WALLPAPER_MAX_BYTES,
  VIDEO_WALLPAPER_MIMES,
} from '../constants';
import type { WallpaperMetadata, WallpaperType } from '../types';
import { saveWallpaperMetadata } from './appStorage';

export class WallpaperError extends Error {}

function extensionForMime(mime: string): string {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' } as Record<string, string>)[mime] ?? 'bin';
}

export function validateWallpaper(file: File, type: WallpaperType): void {
  const supported = type === 'image' ? IMAGE_WALLPAPER_MIMES : VIDEO_WALLPAPER_MIMES;
  const maxBytes = type === 'image' ? IMAGE_WALLPAPER_MAX_BYTES : VIDEO_WALLPAPER_MAX_BYTES;
  if (!supported.has(file.type)) {
    throw new WallpaperError(type === 'image' ? '不支持的静态壁纸格式，请选择 JPG、PNG 或 WebP。' : '不支持的动态壁纸格式，请选择 MP4 或 WebM。');
  }
  if (file.size > maxBytes) {
    throw new WallpaperError(type === 'image' ? '静态壁纸不能超过 30 MB。' : '动态壁纸不能超过 200 MB。');
  }
}

async function validateWallpaperContent(file: File, type: WallpaperType): Promise<void> {
  if (type === 'image') {
    try {
      const bitmap = await createImageBitmap(file);
      const valid = bitmap.width > 0 && bitmap.height > 0;
      bitmap.close();
      if (!valid) throw new Error('invalid dimensions');
      return;
    } catch {
      throw new WallpaperError('静态壁纸内容无法识别，请选择有效的 JPG、PNG 或 WebP 图片。');
    }
  }

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('metadata timeout')), 15_000);
      video.onloadedmetadata = () => {
        window.clearTimeout(timeout);
        if (Number.isFinite(video.duration) && video.videoWidth > 0 && video.videoHeight > 0) resolve();
        else reject(new Error('invalid metadata'));
      };
      video.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('decode failed'));
      };
      video.src = objectUrl;
      video.load();
    });
  } catch {
    throw new WallpaperError('动态壁纸内容无法识别，请选择有效的 MP4 或 WebM 视频。');
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

async function root(): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage?.getDirectory) throw new WallpaperError('当前环境不支持 OPFS，无法保存壁纸。');
  return navigator.storage.getDirectory();
}

function writeError(error: unknown): WallpaperError {
  if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NotAllowedError')) {
    return new WallpaperError('磁盘空间不足或存储权限受限，壁纸未保存。');
  }
  return new WallpaperError('OPFS 写入失败，当前壁纸未改变。');
}

export async function importWallpaper(
  file: File,
  type: WallpaperType,
  previous: WallpaperMetadata | null,
): Promise<WallpaperMetadata> {
  validateWallpaper(file, type);
  await validateWallpaperContent(file, type);
  const directory = await root();
  const opfsFileName = `wallpaper-${crypto.randomUUID()}.${extensionForMime(file.type)}`;
  try {
    const handle = await directory.getFileHandle(opfsFileName, { create: true });
    const writable = await handle.createWritable();
    await file.stream().pipeTo(writable);
    const stored = await handle.getFile();
    if (stored.size !== file.size) throw new Error('size mismatch');
    const metadata: WallpaperMetadata = {
      type,
      fileName: file.name,
      mimeType: file.type,
      opfsFileName,
      size: file.size,
    };
    try {
      await saveWallpaperMetadata(metadata);
    } catch (error) {
      await directory.removeEntry(opfsFileName).catch(() => undefined);
      throw error;
    }
    if (previous?.opfsFileName && previous.opfsFileName !== opfsFileName) {
      await directory.removeEntry(previous.opfsFileName).catch(() => undefined);
    }
    await cleanupWallpaperFiles(opfsFileName);
    return metadata;
  } catch (error) {
    await directory.removeEntry(opfsFileName).catch(() => undefined);
    if (error instanceof WallpaperError) throw error;
    throw writeError(error);
  }
}

export async function loadWallpaperFile(metadata: WallpaperMetadata): Promise<File> {
  try {
    const directory = await root();
    const handle = await directory.getFileHandle(metadata.opfsFileName);
    return await handle.getFile();
  } catch {
    throw new WallpaperError('壁纸读取失败，可在设置中删除后重新导入。');
  }
}

export async function deleteWallpaper(metadata: WallpaperMetadata | null): Promise<void> {
  await saveWallpaperMetadata(null);
  if (!metadata) return;
  const directory = await root();
  await directory.removeEntry(metadata.opfsFileName).catch(() => undefined);
  await cleanupWallpaperFiles(null);
}

export async function cleanupWallpaperFiles(keep: string | null): Promise<void> {
  const directory = await root();
  const iterableDirectory = directory as FileSystemDirectoryHandle & {
    keys(): AsyncIterableIterator<string>;
  };
  for await (const name of iterableDirectory.keys()) {
    if (name.startsWith('wallpaper-') && name !== keep) {
      await directory.removeEntry(name).catch(() => undefined);
    }
  }
}
