export type SearchProviderId = 'bing' | 'google' | 'baidu' | 'duckduckgo' | 'sogou';
export type IconMode = 'favicon' | 'custom';
export type WallpaperType = 'image' | 'video';

export interface Shortcut {
  id: string;
  name: string;
  url: string;
  iconMode: IconMode;
  customIconId?: string;
  slot: number;
  createdAt: number;
}

export interface WallpaperMetadata {
  type: WallpaperType;
  fileName: string;
  mimeType: string;
  opfsFileName: string;
  size: number;
}

export interface AppDataV1 {
  schemaVersion: 1;
  preferences: {
    searchProvider: SearchProviderId;
  };
  shortcuts: Shortcut[];
  wallpaperMetadata: WallpaperMetadata | null;
}

export interface AppDataV2 {
  schemaVersion: 2;
  preferences: {
    searchProvider: SearchProviderId;
  };
  layout: {
    searchSlot: number;
  };
  shortcuts: Shortcut[];
  wallpaperMetadata: WallpaperMetadata | null;
}

export type AppData = AppDataV2;
