import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_WALLPAPER_MAX_BYTES, VIDEO_WALLPAPER_MAX_BYTES } from '../constants';
import { cleanupWallpaperFiles, deleteWallpaper, importWallpaper, validateWallpaper } from './wallpaperStore';
import { installTestLocks } from '../test/locks';
import { migrateAppData } from './appStorage';
import type { AppData } from '../types';

function fakeFile(name: string, type: string, size: number): File {
  return { name, type, size } as File;
}

describe('壁纸导入校验', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('接受 30 MB 以内的 %s 图片', (type) => {
    expect(() => validateWallpaper(fakeFile('wallpaper', type, IMAGE_WALLPAPER_MAX_BYTES), 'image')).not.toThrow();
  });

  it('拒绝超过 30 MB 的图片', () => {
    expect(() => validateWallpaper(fakeFile('large.jpg', 'image/jpeg', IMAGE_WALLPAPER_MAX_BYTES + 1), 'image')).toThrow('30 MB');
  });

  it.each(['video/mp4', 'video/webm'])('接受 200 MB 以内的 %s 视频', (type) => {
    expect(() => validateWallpaper(fakeFile('wallpaper', type, VIDEO_WALLPAPER_MAX_BYTES), 'video')).not.toThrow();
  });

  it('拒绝超过 200 MB 的视频', () => {
    expect(() => validateWallpaper(fakeFile('large.mp4', 'video/mp4', VIDEO_WALLPAPER_MAX_BYTES + 1), 'video')).toThrow('200 MB');
  });

  it('拒绝不支持的壁纸 MIME', () => {
    expect(() => validateWallpaper(fakeFile('bad.gif', 'image/gif', 100), 'image')).toThrow('不支持');
  });
});

describe('壁纸文件与配置的一致性', () => {
  let restoreLocks: () => void;
  let stored: AppData;
  let files: Set<string>;
  let failCleanup: boolean;
  let failWrite: boolean;
  const oldName = 'wallpaper-old.png';
  const storageDescriptor = Object.getOwnPropertyDescriptor(navigator, 'storage');
  const write = vi.fn(async (value: { appData: AppData }) => { stored = structuredClone(value.appData); });
  let pipeTo: () => Promise<void>;
  const file = { name: 'new.png', type: 'image/png', size: 3, stream: () => ({ pipeTo: () => pipeTo() }) } as unknown as File;

  beforeEach(() => {
    restoreLocks = installTestLocks();
    stored = { ...migrateAppData(undefined), wallpaperMetadata: { type: 'image', fileName: 'old.png', mimeType: 'image/png', opfsFileName: oldName, size: 3 } };
    files = new Set([oldName]); failCleanup = false; failWrite = false;
    pipeTo = async () => { if (failWrite) throw new Error('write failed'); };
    write.mockReset(); write.mockImplementation(async (value: { appData: AppData }) => { stored = structuredClone(value.appData); });
    vi.stubGlobal('chrome', { storage: { local: { get: async () => ({ appData: structuredClone(stored) }), set: write } } });
    vi.stubGlobal('createImageBitmap', async () => ({ width: 1, height: 1, close() {} }));
    const directory = {
      getFileHandle: async (name: string) => {
        files.add(name);
        return { createWritable: async () => ({}), getFile: async () => ({ size: 3 }) };
      },
      removeEntry: async (name: string) => { files.delete(name); },
      keys: async function* () {
        if (failCleanup) throw new Error('cleanup failed');
        yield* [...files];
      },
    };
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { getDirectory: async () => directory } });
  });
  afterEach(() => {
    restoreLocks(); vi.unstubAllGlobals();
    if (storageDescriptor) Object.defineProperty(navigator, 'storage', storageDescriptor);
    else Reflect.deleteProperty(navigator, 'storage');
  });

  it('提交后的清理失败不会回滚或删除新壁纸', async () => {
    failCleanup = true;
    const data = await importWallpaper(file, 'image');
    expect(data.wallpaperMetadata?.fileName).toBe('new.png');
    expect(files.has(stored.wallpaperMetadata!.opfsFileName)).toBe(true);
    failCleanup = false;
    await cleanupWallpaperFiles();
    expect([...files]).toEqual([data.wallpaperMetadata!.opfsFileName]);
  });

  it('元数据保存失败时删除新文件并保留旧壁纸', async () => {
    write.mockRejectedValueOnce(new Error('storage failed'));
    await expect(importWallpaper(file, 'image')).rejects.toThrow('当前壁纸未改变');
    expect(stored.wallpaperMetadata?.opfsFileName).toBe(oldName);
    expect([...files]).toEqual([oldName]);
  });

  it('写入失败时清理未提交文件并保留原配置', async () => {
    failWrite = true;
    await expect(importWallpaper(file, 'image')).rejects.toThrow('当前壁纸未改变');
    expect(stored.wallpaperMetadata?.opfsFileName).toBe(oldName);
    expect([...files]).toEqual([oldName]);
  });

  it('其他页面的启动清理会等待正在导入的壁纸提交', async () => {
    let release!: () => void; let started!: () => void;
    const writing = new Promise<void>((resolve) => { started = resolve; });
    const resume = new Promise<void>((resolve) => { release = resolve; });
    pipeTo = async () => { started(); await resume; };
    const importing = importWallpaper(file, 'image');
    await writing;
    let cleaned = false;
    const cleaning = cleanupWallpaperFiles().then(() => { cleaned = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(cleaned).toBe(false);
    release();
    const [data] = await Promise.all([importing, cleaning]);
    expect([...files]).toEqual([data.wallpaperMetadata!.opfsFileName]);
  });

  it('删除提交后清理失败仍恢复默认背景，之后可重试清理', async () => {
    failCleanup = true;
    const data = await deleteWallpaper();
    expect(data.wallpaperMetadata).toBeNull();
    expect(stored.wallpaperMetadata).toBeNull();
    failCleanup = false;
    await cleanupWallpaperFiles();
    expect(files.size).toBe(0);
  });

  it('未知数据版本时不创建或清理任何壁纸文件', async () => {
    stored = { ...stored, schemaVersion: 3 } as unknown as AppData;
    await expect(cleanupWallpaperFiles()).rejects.toThrow('原始数据已保留');
    await expect(importWallpaper(file, 'image')).rejects.toThrow('原始数据已保留');
    expect([...files]).toEqual([oldName]);
    expect(write).not.toHaveBeenCalled();
  });
});
