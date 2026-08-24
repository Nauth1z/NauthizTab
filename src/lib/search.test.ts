import { describe, expect, it } from 'vitest';
import { buildSearchUrl } from './search';

describe('buildSearchUrl', () => {
  it.each([
    ['bing', 'https://www.bing.com/search?q=%E4%BD%A0%E5%A5%BD%20edge'],
    ['google', 'https://www.google.com/search?q=%E4%BD%A0%E5%A5%BD%20edge'],
    ['baidu', 'https://www.baidu.com/s?wd=%E4%BD%A0%E5%A5%BD%20edge'],
    ['duckduckgo', 'https://duckduckgo.com/?q=%E4%BD%A0%E5%A5%BD%20edge'],
    ['sogou', 'https://www.sogou.com/web?query=%E4%BD%A0%E5%A5%BD%20edge'],
  ] as const)('为 %s 生成编码后的搜索地址', (provider, expected) => {
    expect(buildSearchUrl(provider, ' 你好 edge ')).toBe(expected);
  });

  it('空白查询不执行搜索', () => {
    expect(buildSearchUrl('bing', '   ')).toBeNull();
  });
});
