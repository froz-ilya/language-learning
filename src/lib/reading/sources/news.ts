import { t } from '../../i18n.svelte';
import { SourceError } from './mediawiki';

/**
 * Fetch for the news sources. Their text isn't open-licensed: it's read on the phone from the
 * publisher, like a browser would, and must never go into public/, the repository or a workflow.
 */
export async function newsGet(url: string, name: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(url, { signal, credentials: 'omit' });
  if (res.status === 404) throw new SourceError(t('reading.error.removed', { name }), 404, 'removed');
  if (!res.ok) throw new SourceError(`HTTP ${res.status}`, res.status);
  return res;
}

/** A link from a publisher's data, used as an href: only https gets through. */
export function httpsUrl(url: unknown, fallback: string): string {
  return typeof url === 'string' && url.startsWith('https://') ? url : fallback;
}
