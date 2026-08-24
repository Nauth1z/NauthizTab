import { describe, expect, it } from 'vitest';
import { IMAGE_WALLPAPER_MAX_BYTES, VIDEO_WALLPAPER_MAX_BYTES } from '../constants';
import { validateWallpaper } from './wallpaperStore';

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
