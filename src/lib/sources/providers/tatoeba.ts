import { checkResponse, SourceError, type Provider } from '../chain';
import type { GoogleLang } from '../../lookup/google';
import { t } from '../../i18n.svelte';

/**
 * Tatoeba (https://tatoeba.org): sentences written and translated by people, CC BY 2.0 FR.
 * Its v1 API is public, needs no key and is CORS-open. The licence asks for credit, so the app
 * says where the sentences are from.
 */
const ENDPOINT = 'https://api.tatoeba.org/v1/sentences';

const CODES: Record<GoogleLang, string> = { de: 'deu', ru: 'rus', en: 'eng' };

export interface ExamplesQuery {
  /** A word or short phrase in `from`. */
  text: string;
  from: GoogleLang;
  to: GoogleLang;
  limit: number;
}

/** A sentence and a person's translation of it. */
export interface ExamplePair {
  id: number;
  text: string;
  translation: string;
  translationId: number;
}

interface ApiSentence {
  id?: unknown;
  text?: unknown;
  translations?: unknown;
}

interface ApiTranslation {
  id?: unknown;
  text?: unknown;
  lang?: unknown;
  is_direct?: unknown;
}

/** Pairs from a /v1/sentences response: each sentence with one translation into `to` (a direct one first). */
export function parseTatoeba(data: unknown, to: GoogleLang): ExamplePair[] {
  const list = (data as { data?: unknown } | null)?.data;
  if (!Array.isArray(list)) throw new SourceError(t('words.error.unexpected', { source: 'Tatoeba' }), { refusal: true });
  const out: ExamplePair[] = [];
  for (const s of list as ApiSentence[]) {
    if (typeof s?.id !== 'number' || typeof s.text !== 'string' || !s.text.trim() || !Array.isArray(s.translations)) continue;
    const trs = (s.translations as ApiTranslation[]).filter(
      (tr) => tr?.lang === CODES[to] && typeof tr.id === 'number' && typeof tr.text === 'string' && tr.text.trim(),
    );
    const tr = trs.find((x) => x.is_direct === true) ?? trs[0];
    if (!tr) continue;
    out.push({ id: s.id, text: s.text.trim(), translation: (tr.text as string).trim(), translationId: tr.id as number });
  }
  return out;
}

/** Sentences containing the query, with a translation into `to`; null when there are none. */
export const tatoebaExamples: Provider<ExamplesQuery, ExamplePair[]> = {
  id: 'tatoeba',
  async run({ text, from, to, limit }, signal) {
    const q = text.trim();
    if (!q) return null;
    const params = new URLSearchParams({
      lang: CODES[from],
      q,
      'trans:lang': CODES[to],
      showtrans: 'matching',
      sort: 'relevance',
      limit: String(limit),
    });
    const res = await fetch(`${ENDPOINT}?${params}`, { signal });
    checkResponse(res, 'Tatoeba');
    let data: unknown;
    try {
      data = await res.json();
    } catch (e) {
      if (signal.aborted) throw e;
      throw new SourceError(t('words.error.unexpected', { source: 'Tatoeba' }), { refusal: true });
    }
    const pairs = parseTatoeba(data, to);
    return pairs.length ? pairs.slice(0, limit) : null;
  },
};
