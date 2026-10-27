import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleError, googlePos, googleTranslate, parseGoogleResponse } from './google';

const TISCH = [
  [['Стол', 'Tisch', null, null, 10]],
  [['noun', ['стол'], [['стол', ['Beköstigung', 'Tafel', 'Kost', 'Küche', 'Tisch']]], 'Tisch', 1]],
  'de',
  null,
  null,
  null,
  null,
  [],
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe('parseGoogleResponse', () => {
  it('reads the translation and dictionary entries', () => {
    expect(parseGoogleResponse(TISCH)).toEqual({ text: 'Стол', dict: [{ pos: 'noun', terms: ['стол'] }] });
  });

  it('concatenates segments and tolerates a missing dictionary', () => {
    const r = parseGoogleResponse([[['Ein.\n', 'Eins.\n'], ['Zwei.', 'Zwei.']], null, 'de']);
    expect(r).toEqual({ text: 'Ein.\nZwei.', dict: [] });
  });

  it('rejects garbage', () => {
    expect(() => parseGoogleResponse({ error: 1 })).toThrow(GoogleError);
  });
});

describe('googleTranslate', () => {
  it('builds a GET request with dt=t and dt=bd', async () => {
    const fetch = vi.fn(async (_url: string) => json(TISCH));
    vi.stubGlobal('fetch', fetch);
    const r = await googleTranslate('Tisch', 'de', 'ru');
    expect(r.text).toBe('Стол');
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.host).toBe('translate.googleapis.com');
    expect(url.searchParams.getAll('dt')).toEqual(['t', 'bd']);
    expect(url.searchParams.get('sl')).toBe('de');
    expect(url.searchParams.get('tl')).toBe('ru');
    expect(url.searchParams.get('q')).toBe('Tisch');
  });

  it('switches to POST for long text', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => json([[['x', 'y']]]));
    vi.stubGlobal('fetch', fetch);
    await googleTranslate('Haus '.repeat(500), 'de', 'en');
    const init = fetch.mock.calls[0][1]!;
    expect(init.method).toBe('POST');
    expect(String(init.body)).toMatch(/^q=Haus/);
  });

  it('returns empty for empty input without a request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await googleTranslate('  ', 'de', 'en')).toEqual({ text: '', dict: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws readable errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([], 429)));
    await expect(googleTranslate('Haus', 'de', 'en')).rejects.toThrow(/rate-limiting/);
    vi.stubGlobal('fetch', vi.fn(async () => json([], 500)));
    await expect(googleTranslate('Haus', 'de', 'en')).rejects.toThrow('Google Translate error 500');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(googleTranslate('Haus', 'de', 'en')).rejects.toThrow(/internet connection/);
  });

  it('passes aborts through unchanged', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => {
        init?.signal?.throwIfAborted();
        return json(TISCH);
      }),
    );
    await expect(googleTranslate('Haus', 'de', 'en', ctrl.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('googlePos', () => {
  it('maps labels', () => {
    expect(googlePos('noun')).toBe('noun');
    expect(googlePos('verb')).toBe('verb');
    expect(googlePos('adjective')).toBe('adj');
    expect(googlePos('adverb')).toBe('other');
    expect(googlePos(undefined)).toBe('other');
  });
});
