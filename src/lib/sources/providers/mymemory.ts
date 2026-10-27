import { checkResponse, SourceError, type Provider } from '../chain';
import type { TextQuery } from './google';

/**
 * MyMemory (https://mymemory.translated.net): free, CORS-open, about 5,000 characters/day per
 * IP without an account. No email parameter is sent.
 */
const ENDPOINT = 'https://api.mymemory.translated.net/get';

/** MyMemory rejects queries longer than 500 bytes. */
export const MYMEMORY_MAX_BYTES = 500;

interface MyMemoryResponse {
  responseData?: { translatedText?: unknown };
  responseStatus?: unknown;
  responseDetails?: unknown;
  quotaFinished?: unknown;
}

const QUOTA_TEXT = /MYMEMORY WARNING|USED ALL AVAILABLE FREE TRANSLATIONS|QUERY LENGTH LIMIT/i;

/**
 * Translated text from a /get response. Throws a refusal SourceError when MyMemory reports a
 * status other than 200 or a quota warning (the warning comes back as the "translation").
 */
export function parseMyMemory(data: unknown): string {
  const d = (data ?? {}) as MyMemoryResponse;
  const text = d.responseData?.translatedText;
  const status = Number(d.responseStatus);
  const details = typeof d.responseDetails === 'string' && d.responseDetails ? d.responseDetails : '';
  if (d.quotaFinished === true || (typeof text === 'string' && QUOTA_TEXT.test(text))) {
    throw new SourceError('MyMemory daily quota used up', { status: 429, refusal: true });
  }
  if (status !== 200) {
    throw new SourceError(`MyMemory error ${status || '?'}${details ? `: ${details}` : ''}`.slice(0, 200), {
      status: Number.isFinite(status) && status > 0 ? status : undefined,
      refusal: true,
    });
  }
  if (typeof text !== 'string') throw new SourceError('Unexpected response from MyMemory', { refusal: true });
  return text.trim();
}

/** MyMemory text translation; null (no answer) when it only echoes the input back. */
export const myMemoryText: Provider<TextQuery, string> = {
  id: 'mymemory',
  async run({ text, from, to }, signal) {
    const q = text.trim();
    if (!q || new TextEncoder().encode(q).length > MYMEMORY_MAX_BYTES) return null;
    const params = new URLSearchParams({ q, langpair: `${from}|${to}` });
    const res = await fetch(`${ENDPOINT}?${params}`, { signal });
    checkResponse(res, 'MyMemory');
    let data: unknown;
    try {
      data = await res.json();
    } catch (e) {
      if (signal.aborted) throw e;
      throw new SourceError('Unexpected response from MyMemory', { refusal: true });
    }
    const out = parseMyMemory(data);
    if (!out || out.toLowerCase() === q.toLowerCase()) return null;
    return out;
  },
};
