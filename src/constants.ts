import type { SearchProviderId } from './types';

export const MAX_SHORTCUTS = 24;
export const GRID_SLOTS = Array.from({ length: MAX_SHORTCUTS }, (_, index) => index);
export const IMAGE_WALLPAPER_MAX_BYTES = 30 * 1024 * 1024;
export const VIDEO_WALLPAPER_MAX_BYTES = 200 * 1024 * 1024;

export interface SearchProvider {
  id: SearchProviderId;
  name: string;
  url: string;
}

export const SEARCH_PROVIDERS: readonly SearchProvider[] = [
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q={query}' },
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q={query}' },
  { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd={query}' },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={query}' },
  { id: 'sogou', name: '搜狗', url: 'https://www.sogou.com/web?query={query}' },
] as const;

export const IMAGE_WALLPAPER_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const VIDEO_WALLPAPER_MIMES = new Set(['video/mp4', 'video/webm']);
export const CUSTOM_ICON_MIMES = IMAGE_WALLPAPER_MIMES;
