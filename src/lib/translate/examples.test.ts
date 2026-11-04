import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isCooling, resetProviders } from '../sources/chain';
import { parseTatoeba } from '../sources/providers/tatoeba';
import { clearExamplesCache, findExamples, wantsExamples } from './examples';

// All sentences here are invented for the tests.

const sentence = (id: number, text: string, translations: { id: number; text: string; lang: string; is_direct?: boolean }[]) => ({
  id,
  text,
  lang: 'deu',
  license: 'CC BY 2.0 FR',
  owner: 'someone',
  translations: translations.map((tr) => ({ is_direct: false, license: 'CC BY 2.0 FR', owner: 'other', ...tr })),
});

const RESPONSE = {
  data: [
    sentence(1, 'Der Vogel kam ums Leben.', [
      { id: 11, text: 'The bird died.', lang: 'eng' },
      { id: 12, text: 'Птица погибла.', lang: 'rus', is_direct: false },
      { id: 13, text: 'Птица умерла.', lang: 'rus', is_direct: true },
    ]),
    sentence(2, 'Niemand kam ums Leben.', [{ id: 21, text: 'Nobody died.', lang: 'eng' }]),
    sentence(3, '  ', [{ id: 31, text: 'Пусто.', lang: 'rus' }]),
  ],
  paging: { total: 3, has_next: false },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('navigator', { onLine: true });
  resetProviders();
  clearExamplesCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseTatoeba', () => {
  it('pairs each sentence with a translation into the target, a direct one first', () => {
    expect(parseTatoeba(RESPONSE, 'ru')).toEqual([{ id: 1, text: 'Der Vogel kam ums Leben.', translation: 'Птица умерла.', translationId: 13 }]);
    expect(parseTatoeba(RESPONSE, 'en').map((p) => p.translation)).toEqual(['The bird died.', 'Nobody died.']);
  });

  it('rejects a response without data', () => {
    expect(() => parseTatoeba({ error: 'x' }, 'ru')).toThrow();
  });
});

describe('findExamples', () => {
  it('asks only for a word or a short phrase', () => {
    expect(wantsExamples('ums Leben')).toBe(true);
    expect(wantsExamples('Der Hund schläft heute sehr lange im Garten.')).toBe(false);
    expect(wantsExamples('   ')).toBe(false);
  });

  it('searches the source language with translations into the target, once per text', async () => {
    const fetch = vi.fn(async (_input: string) => json(RESPONSE));
    vi.stubGlobal('fetch', fetch);
    const pairs = await findExamples('ums  Leben', 'de', 'ru');
    expect(pairs).toHaveLength(1);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://api.tatoeba.org/v1/sentences');
    expect(url.searchParams.get('lang')).toBe('deu');
    expect(url.searchParams.get('q')).toBe('ums Leben');
    expect(url.searchParams.get('trans:lang')).toBe('rus');
    expect(url.searchParams.get('sort')).toBe('relevance');

    await findExamples('Ums Leben', 'de', 'ru');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('gives nothing (and cools down) when Tatoeba fails, then asks again later', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 503)));
    expect(await findExamples('погибнуть', 'ru', 'de')).toEqual([]);
    expect(isCooling('tatoeba')).toBe(true);

    resetProviders();
    const fetch = vi.fn(async () => json({ data: [] }));
    vi.stubGlobal('fetch', fetch);
    expect(await findExamples('погибнуть', 'ru', 'de')).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never asks for the same language on both sides', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await findExamples('Haus', 'de', 'de')).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
