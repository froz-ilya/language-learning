import type { Lang, Pos } from '../types';
import { SourceError } from '../sources/chain';
import { t } from '../i18n.svelte';

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

/** A monolingual definition (`dt=md`): the word explained in its own language, with an example. */
export interface Definition {
  pos: string;
  gloss: string;
  example?: string;
}

export interface GoogleResult {
  text: string;
  dict: DictEntry[];
  /** Only when asked for with `extras` and Google has them (single words). */
  definitions?: Definition[];
  /** Usage examples of the source word (`dt=ex`), plain text; only with `extras`. */
  examples?: string[];
}

export interface GoogleOptions {
  /**
   * 'gtx' (the default) or 'dict-chrome-ex' (Google's browser extension): the same endpoint and
   * answer, but each client has its own rate limit, so the second still answers when gtx is at 429.
   */
  client?: 'gtx' | 'dict-chrome-ex';
  /** Also ask for definitions and examples (`dt=md`, `dt=ex`); only filled for single words. */
  extras?: boolean;
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
  opts: GoogleOptions = {},
): Promise<GoogleResult> {
  if (!text.trim()) return { text: '', dict: [] };

  const params = new URLSearchParams({ client: opts.client ?? 'gtx', sl: from, tl: to, hl: 'en' });
  params.append('dt', 't');
  params.append('dt', 'bd');
  if (opts.extras) {
    params.append('dt', 'md');
    params.append('dt', 'ex');
  }
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
    throw new GoogleError(t('words.error.googleUnreachable'));
  }
  if (res.status === 429) {
    throw new GoogleError(t('words.error.rateLimitedWait', { source: 'Google Translate' }), { status: 429 });
  }
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    throw new GoogleError(t('words.error.googleRedirect'), { status: 302 });
  }
  if (!res.ok) throw new GoogleError(`Google Translate error ${res.status}`, { status: res.status });

  let data: unknown;
  try {
    data = await res.json();
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new GoogleError(t('words.error.googleUnexpected'), { refusal: true });
  }
  return parseGoogleResponse(data);
}

export function parseGoogleResponse(data: unknown): GoogleResult {
  if (!Array.isArray(data) || !(Array.isArray(data[0]) || data[0] === null)) {
    throw new GoogleError(t('words.error.googleUnexpected'));
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
  const result: GoogleResult = { text, dict };
  const definitions = parseDefinitions(data[12]);
  if (definitions.length) result.definitions = definitions;
  const examples = parseExamples(data[13]);
  if (examples.length) result.examples = examples;
  return result;
}

/** Google's examples come with <b> around the word and the odd HTML entity. */
function plain(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `dt=md`: [[pos, [[gloss, id, example?], …], lemma, …], …]. */
function parseDefinitions(block: unknown): Definition[] {
  if (!Array.isArray(block)) return [];
  const out: Definition[] = [];
  for (const group of block as unknown[]) {
    if (!Array.isArray(group) || !Array.isArray(group[1])) continue;
    const pos = typeof group[0] === 'string' ? group[0] : '';
    for (const d of group[1] as unknown[]) {
      if (!Array.isArray(d) || typeof d[0] !== 'string' || !plain(d[0])) continue;
      const example = typeof d[2] === 'string' ? plain(d[2]) : '';
      out.push({ pos, gloss: plain(d[0]), ...(example ? { example } : {}) });
    }
  }
  return out;
}

/** `dt=ex`: [[[sentence with <b>, …], …]]. */
function parseExamples(block: unknown): string[] {
  if (!Array.isArray(block) || !Array.isArray(block[0])) return [];
  const out: string[] = [];
  for (const e of block[0] as unknown[]) {
    const s = Array.isArray(e) && typeof e[0] === 'string' ? plain(e[0]) : '';
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
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
