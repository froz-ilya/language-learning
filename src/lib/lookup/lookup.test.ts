import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, LookupResult } from '../types';
import type { LexEntry, LocalHit } from '../dict/types';

// In-memory stand-ins for IndexedDB (node has none).
const mem = vi.hoisted(() => ({ cache: new Map<string, unknown>(), saved: [] as unknown[] }));

vi.mock('../db/schema', () => ({
  db: {
    lookupCache: {
      get: async (key: string) => mem.cache.get(key),
      put: async (row: { key: string }) => void mem.cache.set(row.key, row),
    },
  },
}));
vi.mock('../db/repo', () => ({
  saveCard: vi.fn(async (card: unknown) => {
    mem.saved.push(card);
    return 1;
  }),
}));

// Offline dictionary stand-in (the real one loads pieces from public/dict/).
const dict = vi.hoisted(() => ({ hits: new Map<string, LocalHit[]>(), prefix: [] as LexEntry[] }));
vi.mock('../dict/local', () => ({
  lookupLocal: async (word: string) => dict.hits.get(word) ?? [],
  prefixLocal: async () => dict.prefix,
}));

import {
  fillCards,
  fillTiming,
  lookupWord,
  lookupWordWithSource,
  mergeIntoCard,
  SourceUnavailableError,
  suggest,
  translateText,
} from './lookup';
import { isCooling, resetProviders } from '../sources/chain';

// ---------- Fetch mock ----------

const FIXTURES = ['Haus', 'Tisch', 'gehen', 'ging', 'Häuser', 'Hausschlüssel', 'Schlüssel', 'schön', 'See', 'Folge'];
const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}.wikitext`, import.meta.url), 'utf8');
const ALL_PAGES: Record<string, string> = Object.fromEntries(FIXTURES.map((n) => [n.normalize('NFC'), fixture(n)]));

type GoogleReply = (q: string, tl: string) => unknown;

/** Default Google: no dictionary, each line translated as "TR(line)". */
const echoGoogle: GoogleReply = (q) => [[[q.split('\n').map((l) => `TR(${l})`).join('\n'), q]], null, 'de'];
/** Google that does not know the word: returns the input unchanged. */
const unknownGoogle: GoogleReply = (q) => [[[q, q]], null, 'de'];

interface MockOptions {
  pages?: Record<string, string>;
  existing?: string[];
  opensearch?: string[];
  google?: GoogleReply | 'fail' | 429;
  wiktionary?: 'fail' | 429;
  /** MyMemory reply for (q, langpair); default: echoes q back (= "doesn't know"). */
  mymemory?: ((q: string, langpair: string) => string) | 'fail';
  /** en.wiktionary REST definition responses by title (others: 404). */
  enDefinitions?: Record<string, unknown>;
  enOpensearch?: string[] | 'fail';
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function mockFetch(opts: MockOptions = {}) {
  const pages = opts.pages ?? ALL_PAGES;
  const calls = { wiki: [] as URLSearchParams[], google: [] as string[], mymemory: [] as string[], en: [] as string[] };
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    init?.signal?.throwIfAborted();
    const url = new URL(input);
    if (url.host === 'translate.googleapis.com') {
      const q = url.searchParams.get('q') ?? new URLSearchParams(String(init?.body ?? '')).get('q') ?? '';
      calls.google.push(q);
      if (opts.google === 'fail') throw new TypeError('Failed to fetch');
      if (opts.google === 429) return json({}, 429);
      return json((opts.google ?? echoGoogle)(q, url.searchParams.get('tl')!));
    }
    if (url.host === 'api.mymemory.translated.net') {
      const q = url.searchParams.get('q')!;
      calls.mymemory.push(q);
      if (opts.mymemory === 'fail') throw new TypeError('Failed to fetch');
      const text = opts.mymemory ? opts.mymemory(q, url.searchParams.get('langpair')!) : q;
      return json({ responseData: { translatedText: text, match: 1 }, quotaFinished: false, responseDetails: '', responseStatus: 200 });
    }
    if (url.host === 'en.wiktionary.org') {
      calls.en.push(decodeURIComponent(url.pathname) + url.search);
      if (url.pathname === '/w/api.php') {
        if (opts.enOpensearch === 'fail') throw new TypeError('Failed to fetch');
        return json([url.searchParams.get('search'), opts.enOpensearch ?? [], [], []]);
      }
      const title = decodeURIComponent(url.pathname.split('/').pop()!);
      const body = opts.enDefinitions?.[title];
      return body ? json(body) : json({ status: 404, type: 'Internal error' }, 404);
    }
    if (url.host === 'de.wiktionary.org') {
      const p = url.searchParams;
      calls.wiki.push(p);
      if (opts.wiktionary === 'fail') throw new TypeError('Failed to fetch');
      if (opts.wiktionary === 429) return json({}, 429);
      switch (p.get('action')) {
        case 'parse': {
          const page = p.get('page')!.normalize('NFC');
          return json(pages[page] !== undefined ? { parse: { wikitext: pages[page] } } : { error: { code: 'missingtitle' } });
        }
        case 'query': {
          const titles = p.get('titles')!.split('|');
          const exist = new Set(opts.existing ?? Object.keys(pages));
          return json({ query: { pages: titles.map((title) => (exist.has(title) ? { title } : { title, missing: true })) } });
        }
        case 'opensearch':
          return json([p.get('search'), opts.opensearch ?? [], [], []]);
      }
    }
    throw new Error(`unexpected fetch ${input}`);
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, calls };
}

const without = (...names: string[]) => Object.fromEntries(Object.entries(ALL_PAGES).filter(([k]) => !names.includes(k)));

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

const lex = (over: Partial<LexEntry> & Pick<LexEntry, 'term' | 'pos'>): LexEntry => ({
  genders: [],
  plural: '',
  praeteritum: '',
  partizip2: '',
  auxiliary: '',
  tr: { ru: '', en: '' },
  rank: 100,
  ...over,
});
const HAUS_LEX = lex({ term: 'Haus', pos: 'noun', genders: ['n'], plural: 'Häuser', tr: { ru: 'дом, здание', en: 'house, home' } });
const GEHEN_LEX = lex({
  term: 'gehen',
  pos: 'verb',
  praeteritum: 'ging',
  partizip2: 'gegangen',
  auxiliary: 'sein',
  tr: { ru: 'идти, ходить', en: 'go, walk' },
});

beforeEach(() => {
  mem.cache.clear();
  mem.saved.length = 0;
  dict.hits.clear();
  dict.prefix = [];
  vi.stubGlobal('localStorage', memoryStorage());
  resetProviders();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------- lookupWord ----------

describe('lookupWord', () => {
  it('looks up a noun on Wiktionary and translates examples in one request', async () => {
    const { calls } = mockFetch();
    const r = (await lookupWord('Haus', 'ru'))!;
    expect(r.term).toBe('Haus');
    expect(r.pos).toBe('noun');
    expect(r.genders).toEqual(['n']);
    expect(r.plural).toBe('Häuser');
    expect(r.translation).toContain('дом');
    // At most 3 meanings ("; ") of at most 3 synonyms (", ").
    expect(r.translation.split('; ').length).toBeLessThanOrEqual(3);
    expect(r.translation.split(/[;,] /).length).toBeLessThanOrEqual(6);
    expect(r.source).toBe('wiktionary');
    expect(r.lemmaOf).toBeUndefined();
    expect(r.examples.length).toBeGreaterThan(0);
    expect(r.examples.length).toBeLessThanOrEqual(3);
    expect(r.examples[0].tr).toBe(`TR(${r.examples[0].de})`);
    expect(calls.google).toHaveLength(1);
  });

  it('uses English translations for lang=en', async () => {
    mockFetch();
    // Meanings of Wiktionary's senses: house (1, 2), home (3).
    expect((await lookupWord('Haus', 'en'))!.translation).toBe('house; home');
  });

  it('keeps the distinct meanings of a word (Folge)', async () => {
    mockFetch();
    expect((await lookupWord('Folge', 'ru'))!.translation).toBe('последствие; череда, ряд; эпизод');
    expect((await lookupWord('die Folge', 'en'))!.translation).toBe('consequence; order; episode');
  });

  it('strips the article from the input', async () => {
    mockFetch();
    const r = (await lookupWord('der Tisch', 'ru'))!;
    expect(r.term).toBe('Tisch');
    expect(r.genders).toEqual(['m']);
    expect(r.plural).toBe('Tische');
    expect(r.translation).toContain('стол');
  });

  it('finds the capitalised page for lowercase input', async () => {
    const { calls } = mockFetch();
    const r = (await lookupWord('haus', 'ru'))!;
    expect(r.term).toBe('Haus');
    expect(calls.wiki.map((p) => p.get('page'))).toEqual(['haus', 'Haus']);
  });

  it('tries the capitalised spelling first when an article was typed', async () => {
    const { calls } = mockFetch();
    await lookupWord('das haus', 'ru');
    expect(calls.wiki[0].get('page')).toBe('Haus');
  });

  it('resolves an inflected verb form to its lemma', async () => {
    mockFetch();
    const r = (await lookupWord('ging', 'ru'))!;
    expect(r.term).toBe('gehen');
    expect(r.lemmaOf).toBe('ging');
    expect(r.pos).toBe('verb');
    expect(r.praeteritum).toBe('ging');
    expect(r.partizip2).toBe('gegangen');
    expect(r.auxiliary).toBe('sein');
  });

  it('resolves a plural to its singular', async () => {
    mockFetch();
    const r = (await lookupWord('Häuser', 'en'))!;
    expect(r.term).toBe('Haus');
    expect(r.lemmaOf).toBe('Häuser');
    expect(r.genders).toEqual(['n']);
  });

  it('guesses gender and plural of an unknown compound from its head', async () => {
    const { calls } = mockFetch({
      pages: without('Hausschlüssel'),
      existing: ['Schlüssel'],
      google: (q) => [[['Ключ от дома', q]], null, 'de'],
    });
    const r = (await lookupWord('Hausschlüssel', 'ru'))!;
    expect(r.source).toBe('compound');
    expect(r.term).toBe('Hausschlüssel');
    expect(r.pos).toBe('noun');
    expect(r.genders).toEqual(['m']);
    expect(r.plural).toBe('Hausschlüssel');
    expect(r.translation).toBe('ключ от дома');
    expect(calls.wiki.filter((p) => p.get('action') === 'query')).toHaveLength(1);
  });

  it('skips existing heads that are not nouns', async () => {
    // The longer head "Sschlüssel" exists but has no German noun entry.
    const { calls } = mockFetch({ pages: { ...without('Hausschlüssel'), Sschlüssel: '== x ({{Sprache|Englisch}}) ==\n' } });
    const r = (await lookupWord('hausschlüssel', 'en'))!;
    expect(r.source).toBe('compound');
    expect(r.term).toBe('Hausschlüssel');
    expect(r.genders).toEqual(['m']);
    expect(calls.wiki.filter((p) => p.get('action') === 'parse').map((p) => p.get('page'))).toContain('Sschlüssel');
  });

  it('falls back to Google only, with POS from the dictionary', async () => {
    mockFetch({
      pages: {},
      existing: [],
      google: (q) => [[['Fast', q]], [['adjective', ['fast', 'quick', 'rapid', 'swift']]], 'de'],
    });
    const r = (await lookupWord('schnell', 'en'))!;
    expect(r.source).toBe('google');
    expect(r.pos).toBe('adj');
    expect(r.translation).toBe('fast, quick, rapid');
    expect(r.examples).toEqual([]);
  });

  it('keeps the gender hint in a Google-only result', async () => {
    mockFetch({ pages: {}, existing: [], google: (q) => [[['Лук', q]], null, 'de'] });
    const r = (await lookupWord('die Zwiebel', 'ru'))!;
    expect(r).toMatchObject({ term: 'Zwiebel', pos: 'noun', genders: ['f'], translation: 'лук', source: 'google' });
  });

  it('uses Google when Wiktionary has no translation in the language', async () => {
    const noRu = ALL_PAGES.Tisch.replace(/^\*\{\{ru\}\}:.*$/gm, '');
    mockFetch({
      pages: { Tisch: noRu },
      google: (q) =>
        q === 'Tisch' ? [[['Стол', q]], [['noun', ['стол', 'табль']]], 'de'] : echoGoogle(q, 'ru'),
    });
    const r = (await lookupWord('Tisch', 'ru'))!;
    expect(r.source).toBe('wiktionary');
    expect(r.translation).toBe('стол, табль');
  });

  it('returns null when nothing is found and caches that', async () => {
    const { fetch } = mockFetch({ pages: {}, existing: [], google: unknownGoogle });
    expect(await lookupWord('qwrtzx', 'ru')).toBeNull();
    const n = fetch.mock.calls.length;
    expect(await lookupWord('qwrtzx', 'ru')).toBeNull();
    expect(fetch.mock.calls.length).toBe(n);
  });

  it('serves repeated lookups from the cache', async () => {
    const { fetch } = mockFetch();
    const first = await lookupWord('Tisch', 'ru');
    const n = fetch.mock.calls.length;
    expect(await lookupWord('Tisch', 'ru')).toEqual(first);
    expect(fetch.mock.calls.length).toBe(n);
    // Other language is a different cache key.
    await lookupWord('Tisch', 'en');
    expect(fetch.mock.calls.length).toBeGreaterThan(n);
  });

  it('ignores expired cache entries', async () => {
    const { fetch } = mockFetch();
    mem.cache.set('v2:ru:Tisch', { key: 'v2:ru:Tisch', result: null, fetchedAt: Date.now() - 2 * 24 * 3600 * 1000 });
    expect((await lookupWord('Tisch', 'ru'))!.term).toBe('Tisch');
    expect(fetch).toHaveBeenCalled();
  });

  it('returns a translation-only result without caching when Wiktionary is down', async () => {
    mockFetch({ wiktionary: 'fail', google: (q) => [[['Стол', q]], [['noun', ['стол']]], 'de'] });
    const r = await lookupWordWithSource('Tisch', 'ru');
    expect(r.via).toBe('google');
    expect(r.result).toMatchObject({ term: 'Tisch', pos: 'noun', translation: 'стол', source: 'google' });
    expect(mem.cache.size).toBe(0);
  });

  it('throws SourceUnavailableError (and caches nothing) when every source fails', async () => {
    mockFetch({ wiktionary: 'fail', google: 'fail', mymemory: 'fail' });
    await expect(lookupWord('Tisch', 'ru')).rejects.toThrow(SourceUnavailableError);
    expect(mem.cache.size).toBe(0);
  });

  it('reports the source and remembers it in the cache', async () => {
    mockFetch();
    expect((await lookupWordWithSource('Tisch', 'ru')).via).toBe('de.wiktionary');
    expect((await lookupWordWithSource('Tisch', 'ru')).via).toBe('de.wiktionary');
    mockFetch({ pages: {}, existing: [], google: unknownGoogle });
    expect(await lookupWordWithSource('qwrtzx', 'ru')).toEqual({ result: null, via: null });
  });

  it('uses en.wiktionary glosses for English when de.wiktionary has none', async () => {
    const noEn = ALL_PAGES.Haus.replace(/^\*\{\{en\}\}:.*$/gm, '');
    const enHaus = JSON.parse(readFileSync(new URL('../sources/providers/__fixtures__/enwiktionary-Haus.json', import.meta.url), 'utf8'));
    const { calls } = mockFetch({ pages: { Haus: noEn }, enDefinitions: { Haus: enHaus } });
    const r = await lookupWordWithSource('Haus', 'en');
    expect(r.via).toBe('de.wiktionary');
    expect(r.result!.translation).toBe('house, building; home; theatre');
    // Google only translated the examples.
    expect(calls.google).toHaveLength(1);
  });

  it('falls back to MyMemory for a word translation when Google is down', async () => {
    const noRu = ALL_PAGES.Tisch.replace(/^\*\{\{ru\}\}:.*$/gm, '');
    const { calls } = mockFetch({
      pages: { Tisch: noRu },
      google: 429,
      mymemory: (q) => (q === 'Tisch' ? 'Стол' : q),
    });
    const r = (await lookupWord('Tisch', 'ru'))!;
    expect(r.translation).toBe('стол');
    expect(calls.google).toHaveLength(1);
    expect(isCooling('google')).toBe(true);
  });

  it('still returns a result when example translation fails, but does not cache it', async () => {
    mockFetch({ google: 'fail' });
    const r = (await lookupWord('Haus', 'ru'))!;
    expect(r.translation).toContain('дом');
    expect(r.examples.length).toBeGreaterThan(0);
    expect(r.examples.every((e) => e.tr === undefined)).toBe(true);
    expect(mem.cache.size).toBe(0);
  });

  it('leaves example translations empty when the line count does not match', async () => {
    mockFetch({ google: (q) => [[['only one line', q]], null, 'de'] });
    const r = (await lookupWord('Haus', 'ru'))!;
    expect(r.examples.every((e) => !e.tr)).toBe(true);
  });
});

// ---------- suggest / translateText ----------

describe('suggest', () => {
  it('returns nothing for short prefixes', async () => {
    const { fetch } = mockFetch();
    expect(await suggest('H', 'ru')).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('drops multi-word titles and adds previews from one Google request', async () => {
    const { calls } = mockFetch({ opensearch: ['Haus', 'Haus am See', 'Hausschlüssel'] });
    const s = await suggest('Haus', 'ru');
    expect(s).toEqual([
      { word: 'Haus', preview: 'TR(Haus)' },
      { word: 'Hausschlüssel', preview: 'TR(Hausschlüssel)' },
    ]);
    expect(calls.google).toEqual(['Haus\nHausschlüssel']);
  });

  it('returns words without previews when Google fails', async () => {
    mockFetch({ opensearch: ['Tisch', 'Tischler'], google: 'fail' });
    expect(await suggest('der Tis', 'en')).toEqual([{ word: 'Tisch' }, { word: 'Tischler' }]);
  });
});

describe('suggest fallbacks', () => {
  it('uses the offline dictionary with its own previews, without any request', async () => {
    dict.prefix = [HAUS_LEX, lex({ term: 'Hausaufgabe', pos: 'noun', tr: { ru: 'домашнее задание', en: 'homework' } })];
    const { fetch } = mockFetch();
    expect(await suggest('Haus', 'ru')).toEqual([
      { word: 'Haus', preview: 'дом, здание' },
      { word: 'Hausaufgabe', preview: 'домашнее задание' },
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('previews a word with several meanings by its first two meanings', async () => {
    dict.prefix = [lex({ term: 'Folge', pos: 'noun', tr: { ru: 'последствие, результат; серия, эпизод; ряд', en: 'consequence; episode' } })];
    mockFetch();
    expect(await suggest('Folg', 'ru')).toEqual([{ word: 'Folge', preview: 'последствие; серия' }]);
    expect(await suggest('Folg', 'en')).toEqual([{ word: 'Folge', preview: 'consequence; episode' }]);
  });

  it('falls back to en.wiktionary when de.wiktionary is down', async () => {
    const { calls } = mockFetch({ wiktionary: 'fail', enOpensearch: ['Hausschlüssel', 'Hausschuh'] });
    const s = await suggest('Hausschl', 'en');
    expect(s.map((x) => x.word)).toEqual(['Hausschlüssel', 'Hausschuh']);
    expect(calls.en).toHaveLength(1);
    expect(calls.google).toEqual(['Hausschlüssel\nHausschuh']);
  });

  it('skips the Google preview request while Google is cooling', async () => {
    mockFetch({ google: 'fail' });
    await translateText('Hallo', 'de', 'en').catch(() => {});
    expect(isCooling('google')).toBe(true);
    const { calls } = mockFetch({ opensearch: ['Tisch', 'Tischler'] });
    expect(await suggest('Tis', 'en')).toEqual([{ word: 'Tisch' }, { word: 'Tischler' }]);
    expect(calls.google).toEqual([]);
  });
});

describe('translateText', () => {
  it('translates via Google', async () => {
    mockFetch({ google: (q, tl) => [[[`${tl}:${q}`, q]], null, 'de'] });
    expect(await translateText('Guten Tag', 'de', 'en')).toBe('en:Guten Tag');
  });

  it('uses MyMemory while Google is cooling', async () => {
    const { calls } = mockFetch({ google: 429, mymemory: (q, pair) => `${pair}:${q}` });
    expect(await translateText('Guten Tag', 'de', 'ru')).toBe('de|ru:Guten Tag');
    expect(isCooling('google')).toBe(true);
    expect(await translateText('Gute Nacht', 'de', 'ru')).toBe('de|ru:Gute Nacht');
    expect(calls.google).toEqual(['Guten Tag']);
    expect(calls.mymemory).toEqual(['Guten Tag', 'Gute Nacht']);
  });

  it('throws when no service answers', async () => {
    mockFetch({ google: 'fail', mymemory: 'fail' });
    await expect(translateText('Guten Tag', 'de', 'ru')).rejects.toThrow(SourceUnavailableError);
  });
});

// ---------- Offline dictionary ----------

describe('offline dictionary', () => {
  it('answers offline without any request', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    dict.hits.set('Haus', [{ entry: HAUS_LEX }]);
    const { fetch } = mockFetch();
    const r = await lookupWordWithSource('das Haus', 'ru');
    expect(r.via).toBe('local');
    expect(r.result).toMatchObject({
      term: 'Haus',
      pos: 'noun',
      genders: ['n'],
      plural: 'Häuser',
      translation: 'дом, здание',
      examples: [],
    });
    expect(fetch).not.toHaveBeenCalled();
    // Examples are missing (offline), so the result isn't cached and is completed later.
    expect(mem.cache.size).toBe(0);
  });

  it('adds Wiktionary examples to a local entry when online, and caches it', async () => {
    dict.hits.set('Haus', [{ entry: HAUS_LEX }]);
    const { calls } = mockFetch();
    const r = await lookupWordWithSource('Haus', 'ru');
    expect(r.via).toBe('local');
    expect(r.result!.translation).toBe('дом, здание');
    expect(r.result!.examples.length).toBeGreaterThan(0);
    expect(r.result!.examples[0].tr).toBe(`TR(${r.result!.examples[0].de})`);
    expect(calls.wiki.map((p) => p.get('page'))).toEqual(['Haus']);
    expect(mem.cache.get('v2:ru:Haus')).toMatchObject({ via: 'local' });
  });

  it('returns the local entry alone when Wiktionary is down', async () => {
    dict.hits.set('Haus', [{ entry: HAUS_LEX }]);
    const { calls } = mockFetch({ wiktionary: 'fail' });
    const r = await lookupWordWithSource('Haus', 'en');
    expect(r).toMatchObject({ via: 'local', result: { term: 'Haus', translation: 'house, home', examples: [] } });
    expect(mem.cache.size).toBe(0);
    // Wiktionary is now cooling and isn't asked again.
    await lookupWordWithSource('Haus', 'en');
    expect(calls.wiki).toHaveLength(1);
    expect(calls.google).toHaveLength(0);
  });

  it('maps an inflected form to its lemma', async () => {
    dict.hits.set('ging', [{ entry: GEHEN_LEX, form: 'ging' }]);
    mockFetch();
    const r = (await lookupWord('ging', 'en'))!;
    expect(r).toMatchObject({ term: 'gehen', lemmaOf: 'ging', pos: 'verb', praeteritum: 'ging', auxiliary: 'sein' });
    expect(r.translation).toBe('go, walk');
  });

  it('picks the homograph matching a typed article', async () => {
    const seeM = lex({ term: 'See', pos: 'noun', genders: ['m'], tr: { ru: 'озеро', en: 'lake' } });
    const seeF = lex({ term: 'See', pos: 'noun', genders: ['f'], tr: { ru: 'море', en: 'sea' } });
    dict.hits.set('See', [{ entry: seeM }, { entry: seeF }]);
    vi.stubGlobal('navigator', { onLine: false });
    mockFetch();
    expect((await lookupWord('die See', 'en'))!.translation).toBe('sea');
  });
});

// ---------- mergeIntoCard ----------

function card(over: Partial<Card> = {}): Card {
  return {
    id: 7,
    setId: 1,
    term: 'haus',
    translation: '',
    pos: 'other',
    genders: [],
    plural: '',
    praeteritum: '',
    partizip2: '',
    auxiliary: '',
    examples: [],
    notes: 'mine',
    starred: 1,
    needsFill: 1,
    known: 0,
    presetId: '',
    createdAt: 1,
    ...over,
  };
}

const RESULT: LookupResult = {
  term: 'Haus',
  pos: 'noun',
  genders: ['n'],
  plural: 'Häuser',
  praeteritum: '',
  partizip2: '',
  auxiliary: '',
  translation: 'дом',
  examples: [{ de: 'Das Haus ist groß.', tr: 'Дом большой.' }],
  source: 'wiktionary',
};

describe('mergeIntoCard', () => {
  it('fills empty fields and clears needsFill', () => {
    const c = card();
    const m = mergeIntoCard(c, RESULT);
    expect(m).toMatchObject({
      term: 'haus',
      translation: 'дом',
      pos: 'noun',
      genders: ['n'],
      plural: 'Häuser',
      examples: RESULT.examples,
      notes: 'mine',
      starred: 1,
      needsFill: 0,
      id: 7,
    });
    expect(m).not.toBe(c);
    expect(c.needsFill).toBe(1);
    expect(c.translation).toBe('');
  });

  it('keeps existing fields', () => {
    const c = card({
      term: 'Haus',
      translation: 'здание',
      pos: 'noun',
      genders: ['m'],
      plural: 'Hause',
      examples: [{ de: 'Mein Satz.' }],
    });
    const m = mergeIntoCard(c, { ...RESULT, pos: 'verb' });
    expect(m.translation).toBe('здание');
    expect(m.pos).toBe('noun');
    expect(m.genders).toEqual(['m']);
    expect(m.plural).toBe('Hause');
    expect(m.examples).toEqual([{ de: 'Mein Satz.' }]);
    expect(m.needsFill).toBe(0);
  });
});

// ---------- fillCards ----------

describe('fillCards', () => {
  beforeEach(() => {
    fillTiming.gapMs = 0;
    fillTiming.rateLimitWaitMs = 0;
  });

  it('fills, saves and counts', async () => {
    mockFetch({ pages: without('Hausschlüssel'), existing: [], google: unknownGoogle });
    const progress: [number, number][] = [];
    const cards = [card({ term: 'Haus' }), card({ term: 'qwrtzx' }), card({ term: 'der Tisch' })];
    const r = await fillCards(cards, 'ru', (d, t) => progress.push([d, t]));
    expect(r).toEqual({ filled: 2, notFound: 1, failed: 0 });
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    const saved = mem.saved as Card[];
    expect(saved).toHaveLength(3);
    expect(saved.every((c) => c.needsFill === 0)).toBe(true);
    expect(saved[0].translation).toContain('дом');
    expect(saved[1].translation).toBe('');
    expect(saved[2].genders).toEqual(['m']);
  });

  it('counts failures without saving', async () => {
    mockFetch({ wiktionary: 'fail' });
    const r = await fillCards([card({ term: 'Haus' })], 'ru');
    expect(r).toEqual({ filled: 0, notFound: 0, failed: 1 });
    expect(mem.saved).toHaveLength(0);
  });

  it('backs off after a rate limit and skips the cooling source afterwards', async () => {
    vi.useFakeTimers();
    fillTiming.rateLimitWaitMs = 20_000;
    const { calls } = mockFetch({ wiktionary: 429 });
    const progress: number[] = [];
    const p = fillCards([card({ term: 'Haus' }), card({ term: 'Tisch' })], 'ru', (d) => progress.push(d));
    await vi.advanceTimersByTimeAsync(19_000);
    expect(progress).toEqual([1]);
    await vi.advanceTimersByTimeAsync(2_000);
    // Google could translate both, but without grammar the words stay "needs fill".
    expect(await p).toEqual({ filled: 0, notFound: 0, failed: 2 });
    expect(calls.wiki).toHaveLength(1);
    expect(mem.saved).toHaveLength(0);
  });

  it('counts a word as failed when every source is cooling', async () => {
    mockFetch({ wiktionary: 'fail', google: 'fail', mymemory: 'fail' });
    await expect(lookupWord('Haus', 'ru')).rejects.toThrow(SourceUnavailableError);
    const { fetch } = mockFetch({ wiktionary: 'fail', google: 'fail', mymemory: 'fail' });
    const r = await fillCards([card({ term: 'Tisch' })], 'ru');
    expect(r).toEqual({ filled: 0, notFound: 0, failed: 1 });
    expect(mem.saved).toHaveLength(0);
    // Wiktionary is skipped (cooling); only the soonest translation source is retried.
    expect(fetch.mock.calls.map(([u]) => new URL(u as string).host)).toEqual(['translate.googleapis.com']);
  });

  it('fills from the offline dictionary when Wiktionary is down', async () => {
    dict.hits.set('Haus', [{ entry: HAUS_LEX }]);
    mockFetch({ wiktionary: 'fail' });
    const r = await fillCards([card({ term: 'das Haus' })], 'ru');
    expect(r).toEqual({ filled: 1, notFound: 0, failed: 0 });
    expect((mem.saved as Card[])[0]).toMatchObject({ translation: 'дом, здание', genders: ['n'], plural: 'Häuser', needsFill: 0 });
  });

  it('stops when aborted', async () => {
    mockFetch();
    const ctrl = new AbortController();
    const r = await fillCards([card({ term: 'Haus' }), card({ term: 'Tisch' })], 'ru', () => ctrl.abort(), ctrl.signal);
    expect(r).toEqual({ filled: 1, notFound: 0, failed: 0 });
    expect(mem.saved).toHaveLength(1);
  });
});
