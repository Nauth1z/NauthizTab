import { SEARCH_PROVIDERS } from '../constants';
import type { SearchProviderId } from '../types';

export function buildSearchUrl(providerId: SearchProviderId, rawQuery: string): string | null {
  const query = rawQuery.trim();
  if (!query) return null;
  const provider = SEARCH_PROVIDERS.find((item) => item.id === providerId) ?? SEARCH_PROVIDERS[0];
  return provider.url.replace('{query}', encodeURIComponent(query));
}
