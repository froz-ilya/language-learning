import { checkResponse, SourceError, type Provider } from '../chain';
import { isAbortError, type GoogleLang } from '../../lookup/google';
import { t } from '../../i18n.svelte';

/**
 * Google Translate's other free endpoint (the one of its browser extension): no key, CORS-open,
 * its own rate limit apart from "gtx". Every sentence goes as its own `q` and comes back as its
 * own translation, so no line of one sentence can shift onto another.
 */
const ENDPOINT = 'https://clients5.google.com/translate_a/t';

export interface SentencesQuery {
  sentences: string[];
  from: GoogleLang;
  to: GoogleLang;
}

/**
 * One translation per sentence from a response: ["…", …], or [["…", "de"], …] when the source
 * language was detected. Null when the response doesn't hold exactly `n` of them.
 */
export function parseSentences(data: unknown, n: number): string[] | null {
  if (!Array.isArray(data) || data.length !== n) return null;
  const out: string[] = [];
  for (const x of data as unknown[]) {
    const s = typeof x === 'string' ? x : Array.isArray(x) && typeof x[0] === 'string' ? x[0] : null;
    if (s === null) return null;
    out.push(s.trim());
  }
  return out;
}

export const googleSentences: Provider<SentencesQuery, string[]> = {
  id: 'google.ext',
  async run({ sentences, from, to }, signal) {
    if (!sentences.length) return [];
    const params = new URLSearchParams({ client: 'dict-chrome-ex', sl: from, tl: to });
    const body = new URLSearchParams();
    for (const s of sentences) body.append('q', s);
    let res: Response;
    try {
      res = await fetch(`${ENDPOINT}?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: body.toString(),
        signal,
      });
    } catch (e) {
      if (isAbortError(e)) throw e;
      throw new SourceError(t('words.error.unexpected', { source: 'Google Translate' }));
    }
    checkResponse(res, 'Google Translate');
    let data: unknown;
    try {
      data = await res.json();
    } catch (e) {
      if (signal.aborted) throw e;
      throw new SourceError(t('words.error.unexpected', { source: 'Google Translate' }), { refusal: true });
    }
    const out = parseSentences(data, sentences.length);
    if (!out) throw new SourceError(t('words.error.unexpected', { source: 'Google Translate' }), { refusal: true });
    // Nothing translated (every sentence echoed back): no answer.
    return out.every((tr, i) => !tr || tr.toLowerCase() === sentences[i].toLowerCase()) ? null : out;
  },
};
