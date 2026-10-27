import type { Lang, Pos } from '../types';
import { SourceError } from '../sources/chain';

/**
 * Google Translate's free "gtx" endpoint: no key, CORS-open, unofficial.
 * Response: [segments, dictionary | null, sourceLang, …]
 *   segments:   [[translated, original, …], …]
 *   dictionary: [[pos, [terms…], [[term, [backTranslations…], …], …], baseForm, posId], …]
 */
const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

/** GET URLs longer than this are sent as POST instead (same response). */
const MAX_GET_QUERY = 1800;

export type GoogleLang = 'de' | Lang;

export interface DictEntry {
  /** English part-of-speech label as Google reports it: "noun", "verb", "adjective", "adverb", … */
  pos: string;
  terms: string[];
}

export interface GoogleResult {
  text: string;
  dict: DictEntry[];
}

/** Google failure; `status` is the HTTP status when there was a response (see SourceError). */
export class GoogleError extends SourceError {
  constructor(message: string, opts: { status?: number; refusal?: boolean } = {}) {
    super(message, opts);
    this.name = 'GoogleError';
  }
}

export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException ? e.name === 'AbortError' : (e as { name?: string } | null)?.name === 'AbortError';
}

/** Translate text; `dict` holds dictionary alternatives (only for single words). */
export async function googleTranslate(
  text: string,
  from: GoogleLang,
  to: GoogleLang,
  signal?: AbortSignal,
): Promise<GoogleResult> {
  if (!text.trim()) return { text: '', dict: [] };

  const params = new URLSearchParams({ client: 'gtx', sl: from, tl: to, hl: 'en' });
  params.append('dt', 't');
  params.append('dt', 'bd');
  const q = new URLSearchParams({ q: text }).toString();

  let res: Response;
  try {
    res =
      q.length <= MAX_GET_QUERY
        ? await fetch(`${ENDPOINT}?${params}&${q}`, { signal })
        : await fetch(`${ENDPOINT}?${params}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: q,
            signal,
          });
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new GoogleError('Could not reach Google Translate. Check your internet connection.');
  }
  if (res.status === 429) {
    throw new GoogleError('Google Translate is rate-limiting requests. Try again in a minute.', { status: 429 });
  }
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    throw new GoogleError('Google Translate redirected the request (blocked).', { status: 302 });
  }
  if (!res.ok) throw new GoogleError(`Google Translate error ${res.status}`, { status: res.status });

  let data: unknown;
  try {
    data = await res.json();
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new GoogleError('Unexpected response from Google Translate.', { refusal: true });
  }
  return parseGoogleResponse(data);
}

export function parseGoogleResponse(data: unknown): GoogleResult {
  if (!Array.isArray(data) || !(Array.isArray(data[0]) || data[0] === null)) {
    throw new GoogleError('Unexpected response from Google Translate.');
  }
  const segments = (data[0] ?? []) as unknown[];
  const text = segments
    .map((s) => (Array.isArray(s) && typeof s[0] === 'string' ? s[0] : ''))
    .join('');

  const dict: DictEntry[] = [];
  if (Array.isArray(data[1])) {
    for (const d of data[1] as unknown[]) {
      if (!Array.isArray(d) || !Array.isArray(d[1])) continue;
      const terms = (d[1] as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim() !== '');
      if (terms.length) dict.push({ pos: typeof d[0] === 'string' ? d[0] : '', terms });
    }
  }
  return { text, dict };
}

/** Map Google's POS label to ours. */
export function googlePos(label: string | undefined): Pos {
  switch (label) {
    case 'noun':
      return 'noun';
    case 'verb':
      return 'verb';
    case 'adjective':
      return 'adj';
    default:
      return 'other';
  }
}
