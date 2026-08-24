import { describe, expect, it } from 'vitest';
import manifest from '../public/manifest.json';

describe('Manifest V3', () => {
  it('接管新标签页且只申请必要权限', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.chrome_url_overrides.newtab).toBe('index.html');
    expect(manifest.permissions.sort()).toEqual(['favicon', 'storage', 'unlimitedStorage'].sort());
    expect(manifest).not.toHaveProperty('background');
    expect(manifest).not.toHaveProperty('content_scripts');
    expect(manifest).not.toHaveProperty('host_permissions');
  });
});
