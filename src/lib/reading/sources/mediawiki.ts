/** Minimal MediaWiki Action API client (anonymous CORS via origin=*). */

export class SourceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

export type Params = Record<string, string | number | undefined>;

/** GET api.php with JSON format v2. Throws SourceError on HTTP or API errors. */
export async function mwGet<T = unknown>(api: string, params: Params, signal?: AbortSignal): Promise<T> {
  const q = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*' });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const res = await fetch(`${api}?${q}`, { signal });
  if (!res.ok) throw new SourceError(`HTTP ${res.status}`, res.status);
  const data = (await res.json()) as T & { error?: { code: string; info: string } };
  if (data && typeof data === 'object' && 'error' in data && data.error) {
    throw new SourceError(`${data.error.code}: ${data.error.info}`);
  }
  return data;
}

/** "https://host/wiki/" + title with underscores, percent-encoded like MediaWiki does. */
export function wikiUrl(base: string, title: string): string {
  return base + encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%3A/g, ':');
}

export interface ParseResponse {
  parse: { title: string; pageid: number; text: string | { '*': string } };
}

/** action=parse HTML of a page (redirects followed). */
export async function parsePage(api: string, title: string, signal?: AbortSignal): Promise<{ title: string; html: string }> {
  const data = await mwGet<ParseResponse>(
    api,
    { action: 'parse', page: title, prop: 'text', redirects: 1, disableeditsection: 1, disabletoc: 1 },
    signal,
  );
  const t = data.parse.text;
  return { title: data.parse.title, html: typeof t === 'string' ? t : t['*'] };
}

export interface SearchResponse {
  query?: { search: { title: string; snippet?: string }[] };
  continue?: { sroffset?: number };
}

export interface RandomResponse {
  query?: { random: { title: string }[] };
  continue?: { rncontinue?: string };
}

export interface PagesResponse {
  query?: { pages: { title: string; pageid?: number; missing?: boolean; extract?: string; index?: number }[] };
  continue?: Record<string, string>;
}
