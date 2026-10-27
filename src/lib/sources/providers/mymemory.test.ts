import { afterEach, describe, expect, it, vi } from 'vitest';
import { SourceError } from '../chain';
import { myMemoryText, parseMyMemory } from './mymemory';

// Recorded from https://api.mymemory.translated.net/get?q=Haus&langpair=de|ru (matches trimmed).
const HAUS = {
  responseData: { translatedText: 'Дом ', match: 1 },
  quotaFinished: false,
  mtLangSupported: null,
  responseDetails: '',
  responseStatus: 200,
  responderId: null,
  exception_code: null,
  matches: [{ id: '431064997', segment: 'Haus ', translation: 'Дом ', source: 'de-DE', target: 'ru-RU', quality: 74 }],
};
// Recorded for langpair=de|xx: errors come back with HTTP 200 and a string status.
const INVALID_PAIR = {
  responseData: { translatedText: "'XX' IS AN INVALID TARGET LANGUAGE . EXAMPLE: LANGPAIR=EN|IT USING 2 LETTER ISO OR RFC3066 LIKE ZH-CN." },
  quotaFinished: null,
  responseDetails: "'XX' IS AN INVALID TARGET LANGUAGE . EXAMPLE: LANGPAIR=EN|IT USING 2 LETTER ISO OR RFC3066 LIKE ZH-CN.",
  responseStatus: '403',
  matches: '',
};
// Daily quota used up (the warning is returned as the "translation").
const QUOTA = {
  responseData: {
    translatedText:
      'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY. NEXT AVAILABLE IN  10 HOURS 05 MINUTES 31 SECONDS VISIT HTTPS://MYMEMORY.TRANSLATED.NET/DOC/USAGELIMITS.PHP TO TRANSLATE MORE',
  },
  quotaFinished: true,
  responseDetails: '',
  responseStatus: 429,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const signal = () => new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

describe('parseMyMemory', () => {
  it('reads the translated text', () => {
    expect(parseMyMemory(HAUS)).toBe('Дом');
  });

  it('treats a status other than 200 as a refusal', () => {
    try {
      parseMyMemory(INVALID_PAIR);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SourceError);
      expect((e as SourceError).status).toBe(403);
      expect((e as SourceError).refusal).toBe(true);
    }
  });

  it('treats the quota warning as a refusal, even with status 200', () => {
    expect(() => parseMyMemory(QUOTA)).toThrow(/quota/);
    const sneaky = { ...QUOTA, quotaFinished: false, responseStatus: 200 };
    expect(() => parseMyMemory(sneaky)).toThrow(SourceError);
    expect(() => parseMyMemory({})).toThrow(SourceError);
  });
});

describe('myMemoryText', () => {
  it('sends q and langpair only (no email)', async () => {
    const fetch = vi.fn(async (_url: string) => json(HAUS));
    vi.stubGlobal('fetch', fetch);
    expect(await myMemoryText.run({ text: 'Haus', from: 'de', to: 'ru' }, signal())).toBe('Дом');
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://api.mymemory.translated.net/get');
    expect([...url.searchParams.keys()].sort()).toEqual(['langpair', 'q']);
    expect(url.searchParams.get('langpair')).toBe('de|ru');
  });

  it('returns null for an echo and for over-long text (no request)', async () => {
    const fetch = vi.fn(async (url: string) =>
      json({ ...HAUS, responseData: { translatedText: new URL(url).searchParams.get('q') } }),
    );
    vi.stubGlobal('fetch', fetch);
    expect(await myMemoryText.run({ text: 'Qwrtz', from: 'de', to: 'ru' }, signal())).toBeNull();
    expect(await myMemoryText.run({ text: 'ä'.repeat(300), from: 'de', to: 'ru' }, signal())).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('throws a typed error on HTTP 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 429)));
    await expect(myMemoryText.run({ text: 'Haus', from: 'de', to: 'ru' }, signal())).rejects.toMatchObject({
      name: 'SourceError',
      status: 429,
      refusal: true,
    });
  });
});
