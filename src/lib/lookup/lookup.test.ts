import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, LookupResult } from '../types';
import type { LexEntry, LocalHit } from '../dict/types';
import type { WikiEntry, WikiSense } from './wiktionary';

// In-memory stand-ins for IndexedDB (node has none).
const mem = vi.hoisted(() => ({
  cache: new Map<string, unknown>(),
  saved: [] as unknown[],
  cards: new Map<number, unknown>(),
  transactions: 0,
}));

vi.mock('../db/schema', () => ({
  db: {
    lookupCache: {
      get: async (key: string) => mem.cache.get(key),
      put: async (row: { key: string }) => void mem.cache.set(row.key, row),
    },
    cards: { get: async (id: number) => structuredClone(mem.cards.get(id)) },
    transaction: async (_mode: string, _table: unknown, fn: () => Promise<unknown>) => {
      mem.transactions++;
      return fn();
    },
  },
}));
vi.mock('../db/repo', () => ({
  saveCard: vi.fn(async (card: { id?: number }) => {
    mem.saved.push(card);
    if (card.id !== undefined) mem.cards.set(card.id, structuredClone(card));
    return card.id ?? 1;
  }),
}));

// Offline dictionary stand-in (the real one loads pieces from public/dict/).
const dict = vi.hoisted(() => ({ hits: new Map<string, LocalHit[]>(), prefix: [] as LexEntry[] }));
vi.mock('../dict/local', () => ({
  lookupLocal: async (word: string) => dict.hits.get(word) ?? [],
  prefixLocal: async () => dict.prefix,
  // Same contract as the real one: every article of a split noun (most common first), else [entry].
  articleVariants: async (entry: LexEntry) => {
    const same = (dict.hits.get(entry.term) ?? []).map((h) => h.entry).filter((e) => e.term === entry.term && e.pos === 'noun');
    return same.length > 1 && same.some((e) => e.genders[0] === entry.genders[0]) ? [...same].sort((a, b) => a.rank - b.rank) : [entry];
  },
}));

// Parsed pages as they are, unless a test gives a page's senses/phrases by hand (wiki.edit).
const wiki = vi.hoisted(() => ({ edit: new Map<string, (e: WikiEntry) => WikiEntry>() }));
vi.mock('./wiktionary', async (importOriginal) => {
  const real = await importOriginal<typeof import('./wiktionary')>();
  return {
    ...real,
    parseEntry(title: string, wikitext: string) {
      const e = real.parseEntry(title, wikitext);
      const edit = e && wiki.edit.get(e.title);
      return edit ? edit(e) : e;
    },
  };
});

import {
  fillCards,
  fillTiming,
  lookupWord,
  lookupWordWithSource,
  mergeIntoCard,
  preferArticle,
  SourceUnavailableError,
  suggest,
  translateText,
} from './lookup';
import { isCooling, resetProviders } from '../sources/chain';
import { matchSenses, meaningSentences } from './meanings';

// ---------- Fetch mock ----------

const FIXTURES = ['Haus', 'Tisch', 'gehen', 'ging', 'Häuser', 'Hausschlüssel', 'Schlüssel', 'schön', 'See', 'Folge', 'treffen', 'freuen', 'beeilen'];
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
  /** de.wiktionary answers 429 from this request on (0-based). */
  wiki429From?: number;
  /** Redirects by (normalized) title. Titles are normalized like MediaWiki: "_" → " ". */
  redirects?: Record<string, string>;
  /** Batched page requests send content for at most this many pages (the API's size limit). */
  maxContents?: number;
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
  const norm = (t: string) => t.normalize('NFC').replace(/_/g, ' ');
  const target = (t: string) => opts.redirects?.[norm(t)] ?? norm(t);
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
      if (opts.wiki429From !== undefined && calls.wiki.length > opts.wiki429From) return json({}, 429);
      switch (p.get('action')) {
        case 'parse': {
          const page = target(p.get('page')!);
          return json(pages[page] !== undefined ? { parse: { wikitext: pages[page] } } : { error: { code: 'missingtitle' } });
        }
        case 'query': {
          const titles = p.get('titles')!.split('|');
          if (p.get('prop') === 'revisions') {
            expect(titles.length).toBeLessThanOrEqual(50);
            expect(Object.fromEntries(p)).toMatchObject({ rvprop: 'content', rvslots: 'main', redirects: '1', formatversion: '2' });
            const normalized = titles.filter((t) => norm(t) !== t.normalize('NFC')).map((t) => ({ from: t, to: norm(t) }));
            const redirects = [...new Set(titles.map(norm))].filter((t) => opts.redirects?.[t]).map((t) => ({ from: t, to: opts.redirects![t] }));
            let sent = 0;
            const out = [...new Set(titles.map(target))].map((title) => {
              if (pages[title] === undefined) return { ns: 0, title, missing: true };
              if (opts.maxContents !== undefined && sent >= opts.maxContents) return { pageid: 1, ns: 0, title };
              sent++;
              return { pageid: 1, ns: 0, title, revisions: [{ slots: { main: { contentmodel: 'wikitext', content: pages[title] } } }] };
            });
            return json({ batchcomplete: true, query: { normalized, redirects, pages: out } });
          }
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
  mem.cards.clear();
  mem.transactions = 0;
  dict.hits.clear();
  dict.prefix = [];
  wiki.edit.clear();
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
    mem.cache.set('v5:ru:Tisch', { key: 'v5:ru:Tisch', result: null, fetchedAt: Date.now() - 2 * 24 * 3600 * 1000 });
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
    expect(mem.cache.get('v5:ru:Haus')).toMatchObject({ via: 'local' });
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

// ---------- Articles with different meanings ----------

describe('articles with different meanings', () => {
  const SEE_M = lex({ term: 'See', pos: 'noun', genders: ['m'], plural: 'Seen', rank: 1112, tr: { ru: 'озеро', en: 'lake' } });
  const SEE_F = lex({ term: 'See', pos: 'noun', genders: ['f'], plural: 'Seen', rank: 2632, tr: { ru: 'море', en: 'sea' } });
  const bothSees = () => dict.hits.set('See', [{ entry: SEE_M }, { entry: SEE_F }]);

  it('gives every article of an offline entry its own translation', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    bothSees();
    mockFetch();
    const r = (await lookupWord('See', 'ru'))!;
    expect(r).toMatchObject({ term: 'See', genders: ['m'], plural: 'Seen', translation: 'озеро' });
    expect(r.articles).toEqual([
      { genders: ['m'], plural: 'Seen', translation: 'озеро', examples: [] },
      { genders: ['f'], plural: 'Seen', translation: 'море', examples: [] },
    ]);
    // A typed article picks its own meaning; the list stays the same.
    const f = (await lookupWord('die See', 'ru'))!;
    expect(f).toMatchObject({ genders: ['f'], translation: 'море' });
    expect(f.articles).toEqual(r.articles);
  });

  it('adds each article’s own Wiktionary examples in one request, and caches the first article', async () => {
    bothSees();
    const { calls } = mockFetch();
    const r = (await lookupWord('die See', 'ru'))!;
    expect(r.genders).toEqual(['f']);
    expect(r.articles!.map((a) => a.translation)).toEqual(['озеро', 'море']);
    const [m, f] = r.articles!;
    expect(m.examples[0]).toEqual({ de: 'Ein ausgetrockneter See hat kein Wasser mehr.', tr: 'TR(Ein ausgetrockneter See hat kein Wasser mehr.)' });
    expect(f.examples.length).toBeGreaterThan(0);
    expect(f.examples.some((e) => e.de.includes('ausgetrocknet'))).toBe(false);
    expect(r.examples).toEqual(f.examples);
    expect(calls.google).toHaveLength(1);
    // The cached row holds der See (first article); "See" and "die See" both read it.
    expect((mem.cache.get('v5:ru:See') as { result: LookupResult }).result.genders).toEqual(['m']);
    expect((await lookupWord('See', 'ru'))!.translation).toBe('озеро');
    expect((await lookupWord('die See', 'ru'))!.translation).toBe('море');
    expect(calls.google).toHaveLength(1);
  });

  it('splits a Wiktionary-only noun by article and leaves gender variants merged', async () => {
    mockFetch({ pages: { ...ALL_PAGES, Teil: fixture('Teil') } });
    const see = (await lookupWord('See', 'en'))!;
    expect(see).toMatchObject({ genders: ['m'], translation: 'lake' });
    expect(see.articles!.map((a) => [a.genders, a.translation])).toEqual([
      [['m'], 'lake'],
      [['f'], 'sea'],
    ]);
    const teil = (await lookupWord('Teil', 'en'))!;
    expect(teil.genders.sort()).toEqual(['m', 'n']);
    expect(teil.articles).toBeUndefined();
  });

  it('asks for a missing translation with the article, so the articles stay apart', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    dict.hits.set('See', [{ entry: SEE_M }, { entry: { ...SEE_F, tr: { ru: '', en: 'sea' } } }]);
    const { calls } = mockFetch({ wiktionary: 'fail', google: (q) => [[[q === 'die See' ? 'море' : `TR(${q})`, q]], null, 'de'] });
    const r = (await lookupWord('See', 'ru'))!;
    expect(r.articles!.map((a) => a.translation)).toEqual(['озеро', 'море']);
    expect(calls.google).toEqual(['die See']);
  });

  it('ignores lookups cached before the split (v2: one merged translation)', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    bothSees();
    mockFetch();
    const merged = { term: 'See', pos: 'noun', genders: ['m', 'f'], translation: 'озеро; море', examples: [] };
    mem.cache.set('v2:ru:See', { key: 'v2:ru:See', result: merged, fetchedAt: Date.now() });
    const r = (await lookupWord('See', 'ru'))!;
    expect(r.genders).toEqual(['m']);
    expect(r.translation).toBe('озеро');
  });

  it('fills a card with the meaning of its own article', () => {
    const r: LookupResult = {
      term: 'See',
      pos: 'noun',
      genders: ['m'],
      plural: 'Seen',
      praeteritum: '',
      partizip2: '',
      auxiliary: '',
      translation: 'озеро',
      examples: [],
      source: 'wiktionary',
      articles: [
        { genders: ['m'], plural: 'Seen', translation: 'озеро', examples: [] },
        { genders: ['f'], plural: '', translation: 'море', examples: [{ de: 'Auf hoher See.' }] },
      ],
    };
    const f = mergeIntoCard(card({ term: 'See', pos: 'noun', genders: ['f'] }), r);
    expect(f).toMatchObject({ genders: ['f'], translation: 'море', plural: '', examples: [{ de: 'Auf hoher See.' }] });
    // No article yet: the first one; an old card with both genders keeps what it has.
    expect(mergeIntoCard(card({ term: 'See' }), r)).toMatchObject({ genders: ['m'], translation: 'озеро' });
    const old = mergeIntoCard(card({ term: 'See', pos: 'noun', genders: ['m', 'f'], translation: 'озеро; море' }), r);
    expect(old).toMatchObject({ genders: ['m', 'f'], translation: 'озеро; море' });
    expect(preferArticle(r, [])).toBe(r);
    expect(preferArticle({ ...r, articles: undefined }, ['f']).translation).toBe('озеро');
  });

  it('suggests each article as its own row', async () => {
    dict.prefix = [SEE_M, lex({ term: 'Seele', pos: 'noun', genders: ['f'], rank: 1500, tr: { ru: 'душа', en: 'soul' } }), SEE_F];
    mockFetch();
    expect(await suggest('See', 'ru')).toEqual([
      { word: 'See', preview: 'озеро', genders: ['m'] },
      { word: 'See', preview: 'море', genders: ['f'] },
      { word: 'Seele', preview: 'душа' },
    ]);
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

let nextId = 100;
/** Cards as stored in the DB (fillCards re-reads each one right before saving it). */
function stored(...over: Partial<Card>[]): Card[] {
  return over.map((o) => {
    const c = card({ id: nextId++, ...o });
    mem.cards.set(c.id!, structuredClone(c));
    return c;
  });
}
const storedTerms = (...terms: string[]) => stored(...terms.map((term) => ({ term })));

/** A small Wiktionary noun page: gender, plural, ru/en translation, two examples. */
function nounPage(w: string, i: number): string {
  const g = (['m', 'f', 'n'] as const)[i % 3];
  return [
    `== ${w} ({{Sprache|Deutsch}}) ==`,
    `=== {{Wortart|Substantiv|Deutsch}}, {{${g}}} ===`,
    '',
    '{{Deutsch Substantiv Übersicht',
    `|Genus=${g}`,
    `|Nominativ Singular=${w}`,
    `|Nominativ Plural=${w}e`,
    '}}',
    '',
    '{{Bedeutungen}}',
    ':[1] etwas',
    '',
    '{{Beispiele}}',
    `:[1] Das ist ein ${w}.`,
    `:[1] Wir sehen den ${w} heute.`,
    '',
    '==== {{Übersetzungen}} ====',
    '{{Ü-Tabelle|1|G=etwas|Ü-Liste=',
    `*{{en}}: [1] {{Ü|en|thing${i}}}`,
    `*{{ru}}: [1] {{Ü|ru|вещь${i}}}`,
    '}}',
    '',
  ].join('\n');
}
const words = (n: number) =>
  Array.from({ length: n }, (_, i) => `Wort${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`);
const nounPages = (ws: string[]) => Object.fromEntries(ws.map((w, i) => [w, nounPage(w, i)]));

/** The old way: one lookup per card, merged in order. */
async function perCard(cards: Card[], lang: 'ru' | 'en' = 'ru'): Promise<Card[]> {
  const out: Card[] = [];
  for (const c of cards) {
    const r = await lookupWord(c.term, lang);
    out.push(r ? mergeIntoCard(c, r) : { ...c, needsFill: 0 });
  }
  return out;
}
const cacheRows = () =>
  Object.fromEntries([...mem.cache].map(([k, v]) => [k, { result: (v as { result: unknown }).result, via: (v as { via?: unknown }).via }]));

describe('fillCards', () => {
  beforeEach(() => {
    fillTiming.batchSize = 50;
    fillTiming.batchGapMs = 0;
  });

  it('fills, saves and counts', async () => {
    mockFetch({ pages: without('Hausschlüssel'), existing: [], google: unknownGoogle });
    const progress: [number, number][] = [];
    const cards = storedTerms('Haus', 'qwrtzx', 'der Tisch');
    const r = await fillCards(cards, 'ru', (d, t) => progress.push([d, t]));
    expect(r).toEqual({ filled: 2, notFound: 1, failed: 0 });
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    const saved = mem.saved as Card[];
    expect(saved.map((c) => c.id)).toEqual(cards.map((c) => c.id));
    expect(saved.every((c) => c.needsFill === 0)).toBe(true);
    expect(saved[0].translation).toContain('дом');
    expect(saved[1].translation).toBe('');
    expect(saved[2].genders).toEqual(['m']);
  });

  it('counts failures without saving', async () => {
    mockFetch({ wiktionary: 'fail' });
    const r = await fillCards(storedTerms('Haus'), 'ru');
    expect(r).toEqual({ filled: 0, notFound: 0, failed: 1 });
    expect(mem.saved).toHaveLength(0);
  });

  it('counts a word as failed when every source is cooling, without asking anyone again', async () => {
    mockFetch({ wiktionary: 'fail', google: 'fail', mymemory: 'fail' });
    await expect(lookupWord('Haus', 'ru')).rejects.toThrow(SourceUnavailableError);
    const { fetch } = mockFetch({ wiktionary: 'fail', google: 'fail', mymemory: 'fail' });
    const r = await fillCards(storedTerms('Tisch'), 'ru');
    expect(r).toEqual({ filled: 0, notFound: 0, failed: 1 });
    expect(mem.saved).toHaveLength(0);
    // Wiktionary is cooling, and without grammar the card stays "needs fill": no request at all.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fills from the offline dictionary when Wiktionary is down', async () => {
    dict.hits.set('Haus', [{ entry: HAUS_LEX }]);
    mockFetch({ wiktionary: 'fail' });
    const r = await fillCards(storedTerms('das Haus'), 'ru');
    expect(r).toEqual({ filled: 1, notFound: 0, failed: 0 });
    expect((mem.saved as Card[])[0]).toMatchObject({ translation: 'дом, здание', genders: ['n'], plural: 'Häuser', needsFill: 0 });
  });

  it('stops when aborted; unsaved cards keep needsFill', async () => {
    mockFetch();
    const ctrl = new AbortController();
    const cards = storedTerms('Haus', 'Tisch');
    const r = await fillCards(cards, 'ru', () => ctrl.abort(), ctrl.signal);
    expect(r).toEqual({ filled: 1, notFound: 0, failed: 0 });
    expect(mem.saved).toHaveLength(1);
    expect((mem.cards.get(cards[1].id!) as Card).needsFill).toBe(1);
  });

  it('stops between batches when aborted', async () => {
    fillTiming.batchSize = 2;
    const ws = words(4);
    const { calls } = mockFetch({ pages: nounPages(ws) });
    const ctrl = new AbortController();
    const cards = storedTerms(...ws);
    const r = await fillCards(cards, 'ru', (d) => d === 2 && ctrl.abort(), ctrl.signal);
    expect(r).toEqual({ filled: 2, notFound: 0, failed: 0 });
    expect(calls.wiki).toHaveLength(1);
    expect(cards.slice(2).map((c) => (mem.cards.get(c.id!) as Card).needsFill)).toEqual([1, 1]);
  });

  it('gives the same cards and cache rows as one lookup per card', async () => {
    const SEE_M = lex({ term: 'See', pos: 'noun', genders: ['m'], plural: 'Seen', rank: 1112, tr: { ru: 'озеро', en: 'lake' } });
    const SEE_F = lex({ term: 'See', pos: 'noun', genders: ['f'], plural: 'Seen', rank: 2632, tr: { ru: 'море', en: 'sea' } });
    const ZWIEBEL = lex({ term: 'Zwiebel', pos: 'noun', genders: ['f'], plural: 'Zwiebeln', tr: { ru: 'лук', en: 'onion' } });
    dict.hits.set('See', [{ entry: SEE_M }, { entry: SEE_F }]);
    dict.hits.set('Zwiebel', [{ entry: ZWIEBEL }]);
    dict.hits.set('Haus', [{ entry: HAUS_LEX }]);
    const opts: MockOptions = {
      // Rote_Bete is normalized to "Rote Bete"; Schreibtisch redirects to Tisch.
      pages: { ...without('Hausschlüssel'), 'Rote Bete': ALL_PAGES.Tisch, Teil: fixture('Teil') },
      redirects: { Schreibtisch: 'Tisch' },
      google: (q, tl) => (/^qwrtzx$/i.test(q) ? unknownGoogle(q, tl) : echoGoogle(q, tl)),
    };
    const terms = [
      'Folge', // cache hit
      'Zwiebel', // offline only (no Wiktionary page)
      'Tisch', // Wiktionary only
      'See', // split noun, offline + Wiktionary
      'die See',
      'gehen', // verb
      'ging', // inflected form → lemma
      'Häuser', // plural → singular
      'haus', // second spelling variant
      'qwrtzx', // nothing anywhere
      'Schreibtisch', // redirect
      'Rote_Bete', // normalized title
      'Hausschlüssel', // compound fallback
      'Teil', // gender variants
      'das Haus', // offline + Wiktionary examples
      'schön',
    ];
    const over: Partial<Card>[] = [...terms.map((term) => ({ term })), { term: 'Tisch', translation: 'мой стол', notes: 'own' }];

    for (const lang of ['ru', 'en'] as const) {
      mem.cache.clear();
      resetProviders();
      mockFetch(opts);
      await lookupWord('Folge', lang);
      const seed = new Map(mem.cache);

      const one = mockFetch(opts);
      const expected = await perCard(stored(...over), lang);
      const expectedCache = cacheRows();

      mem.cache = new Map(seed);
      mem.saved.length = 0;
      resetProviders();
      const many = mockFetch(opts);
      const r = await fillCards(stored(...over), lang);
      const saved = mem.saved as Card[];
      expect(saved.map((c) => ({ ...c, id: 0 }))).toEqual(expected.map((c) => ({ ...c, id: 0 })));
      expect(cacheRows()).toEqual(expectedCache);
      expect(r).toEqual({ filled: over.length - 1, notFound: 1, failed: 0 });
      // One request per round of pages (variants, lemmas, compound heads), one for all examples.
      expect(many.calls.wiki.length).toBeLessThanOrEqual(6);
      expect(many.calls.wiki.length).toBeLessThan(one.calls.wiki.length / 2);
      expect(many.calls.google.length).toBeLessThan(one.calls.google.length / 2);
    }
  });

  it('needs 1 Wiktionary and 1 translation request for 30 words (one each per card before)', async () => {
    const ws = words(30);
    dict.hits.set(ws[0], [{ entry: lex({ term: ws[0], pos: 'noun', genders: ['m'], tr: { ru: 'вещь', en: 'thing' } }) }]);
    const opts = { pages: nounPages(ws) };
    const one = mockFetch(opts);
    await perCard(storedTerms(...ws));
    expect([one.calls.wiki.length, one.calls.google.length]).toEqual([30, 30]);

    mem.cache.clear();
    const many = mockFetch(opts);
    const r = await fillCards(storedTerms(...ws), 'ru');
    expect(r).toEqual({ filled: 30, notFound: 0, failed: 0 });
    expect([many.calls.wiki.length, many.calls.google.length]).toEqual([1, 1]);
    expect(many.calls.google[0].split('\n')).toHaveLength(60);
    const saved = mem.saved as Card[];
    expect(saved.map((c) => c.term)).toEqual(ws);
    expect(saved[1]).toMatchObject({ translation: 'вещь1', genders: ['f'], plural: `${ws[1]}e` });
    expect(saved[1].examples).toEqual([
      { de: `Das ist ein ${ws[1]}.`, tr: `TR(Das ist ein ${ws[1]}.)` },
      { de: `Wir sehen den ${ws[1]} heute.`, tr: `TR(Wir sehen den ${ws[1]} heute.)` },
    ]);
  });

  it('needs 6 + 6 requests for 300 words (600 before)', async () => {
    const ws = words(300);
    const { calls } = mockFetch({ pages: nounPages(ws) });
    const progress: number[] = [];
    const r = await fillCards(storedTerms(...ws), 'ru', (d) => progress.push(d));
    expect(r).toEqual({ filled: 300, notFound: 0, failed: 0 });
    expect([calls.wiki.length, calls.google.length]).toEqual([6, 6]);
    expect(progress).toEqual(ws.map((_, i) => i + 1));
  });

  it('goes on without Wiktionary after a 429 mid-run, without waiting in a loop', async () => {
    vi.useFakeTimers();
    fillTiming.batchGapMs = 500;
    const ws = words(120);
    // Two words of the last batch are in the offline dictionary.
    for (const w of ws.slice(110, 112)) dict.hits.set(w, [{ entry: lex({ term: w, pos: 'noun', genders: ['n'], tr: { ru: 'вещь', en: 'thing' } }) }]);
    const { calls } = mockFetch({ pages: nounPages(ws), wiki429From: 1 });
    const cards = storedTerms(...ws);
    let result: unknown = null;
    void fillCards(cards, 'ru').then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(1_100); // the two pauses between batches
    expect(result).toEqual({ filled: 52, notFound: 0, failed: 68 });
    expect(isCooling('de.wiktionary')).toBe(true);
    // Batch 1: one request; batch 2: refused; batch 3: not asked.
    expect(calls.wiki).toHaveLength(2);
    expect(calls.google).toHaveLength(1);
    const after = (c: Card) => mem.cards.get(c.id!) as Card;
    expect(cards.slice(50, 110).every((c) => after(c).needsFill === 1)).toBe(true);
    expect(cards.slice(110, 112).map((c) => [after(c).translation, after(c).needsFill])).toEqual([
      ['вещь', 0],
      ['вещь', 0],
    ]);
  });

  it('translates per card when the batch comes back with another number of lines', async () => {
    const ws = words(3);
    const { calls } = mockFetch({
      pages: nounPages(ws),
      google: (q, tl) => (q.split('\n').length > 2 ? [[['eine Zeile', q]], null, 'de'] : echoGoogle(q, tl)),
    });
    expect(await fillCards(storedTerms(...ws), 'ru')).toEqual({ filled: 3, notFound: 0, failed: 0 });
    expect(calls.google.map((q) => q.split('\n').length)).toEqual([6, 2, 2, 2]);
    expect((mem.saved as Card[]).every((c) => c.examples.every((e) => e.tr === `TR(${e.de})`))).toBe(true);
  });

  it('translates per card through MyMemory when Google refuses the batch', async () => {
    const ws = words(2);
    const { calls } = mockFetch({ pages: nounPages(ws), google: 429, mymemory: (q) => `MM(${q})` });
    expect(await fillCards(storedTerms(...ws), 'ru')).toEqual({ filled: 2, notFound: 0, failed: 0 });
    expect(calls.google).toHaveLength(1);
    expect(calls.mymemory).toHaveLength(2);
    expect((mem.saved as Card[])[0].examples[0].tr).toMatch(/^MM\(/);
  });

  it('never overwrites the user’s translation, and does not ask for one it would not use', async () => {
    const noRu = ALL_PAGES.Tisch.replace(/^\*\{\{ru\}\}:.*$/gm, '');
    const { calls } = mockFetch({ pages: { ...ALL_PAGES, Tisch: noRu } });
    const cards = stored({ term: 'Tisch', translation: 'мой стол' }, { term: 'Haus', translation: 'мой дом' });
    expect(await fillCards(cards, 'ru')).toEqual({ filled: 2, notFound: 0, failed: 0 });
    const saved = mem.saved as Card[];
    expect(saved.map((c) => c.translation)).toEqual(['мой стол', 'мой дом']);
    expect(saved[0]).toMatchObject({ genders: ['m'], plural: 'Tische', pos: 'noun' });
    // Only the example sentences were translated (no "Tisch" word request).
    expect(calls.google).toHaveLength(1);
    expect(calls.google[0].split('\n')).not.toContain('Tisch');
    // The Tisch result lacks its translation, so it isn't cached; Haus is.
    expect([...mem.cache.keys()]).toEqual(['v5:ru:Haus']);
  });

  it('continues with the pages a response left out (size limit)', async () => {
    const ws = words(5);
    const { calls } = mockFetch({ pages: nounPages(ws), maxContents: 2 });
    expect(await fillCards(storedTerms(...ws), 'ru')).toEqual({ filled: 5, notFound: 0, failed: 0 });
    expect(calls.wiki.map((p) => p.get('titles')!.split('|').length)).toEqual([5, 3, 1]);
  });

  it('keeps edits made while filling and does not re-create deleted cards', async () => {
    const [haus, tisch, gehen] = storedTerms('Haus', 'Tisch', 'gehen');
    mockFetch({
      google: (q, tl) => {
        // The user edits Haus and deletes gehen while the words are being looked up.
        mem.cards.set(haus.id!, { ...haus, translation: 'моё', notes: 'edited', starred: 0 });
        mem.cards.delete(gehen.id!);
        return echoGoogle(q, tl);
      },
    });
    expect(await fillCards([haus, tisch, gehen], 'ru')).toEqual({ filled: 2, notFound: 0, failed: 0 });
    const saved = mem.saved as Card[];
    expect(saved.map((c) => c.term)).toEqual(['Haus', 'Tisch']);
    expect(saved[0]).toMatchObject({ translation: 'моё', notes: 'edited', starred: 0, genders: ['n'], plural: 'Häuser', needsFill: 0 });
    expect(mem.cards.has(gehen.id!)).toBe(false);
    expect(mem.transactions).toBe(3);
  });
});

// ---------- Examples by meaning ----------

const sense = (n: number, ru: string[], en: string[], examples: string[] = []): WikiSense => ({ n, translations: { ru, en }, examples });

describe('matchSenses', () => {
  const FOLGE = [
    sense(1, ['последствие', 'результат'], ['consequence'], ['Das hat Folgen.']),
    sense(2, ['череда', 'ряд'], ['order'], ['In rascher Folge.']),
    sense(3, ['серия', 'эпизод'], ['episode'], ['Die letzte Folge.']),
  ];

  it('matches a single meaning to the sense with its words (infrage)', () => {
    const s = [sense(1, ['под вопросом'], ['in question'], ['Das Projekt steht infrage.'])];
    expect(matchSenses('под вопросом', s, 'ru')).toEqual([s]);
    // A page with one sense is that sense even when no word is shared.
    expect(matchSenses('сомнительно', s, 'ru')).toEqual([s]);
  });

  it('matches each meaning to its own sense, whatever their order', () => {
    expect(matchSenses('последствие; эпизод; ряд', FOLGE, 'ru')).toEqual([[FOLGE[0]], [FOLGE[2]], [FOLGE[1]]]);
    expect(matchSenses('consequence; episode', FOLGE, 'en')).toEqual([[FOLGE[0]], [FOLGE[2]]]);
  });

  it('gives an unmatched meaning no sense rather than another meaning’s', () => {
    expect(matchSenses('последствие; что-то другое', FOLGE, 'ru')).toEqual([[FOLGE[0]], []]);
    // Several senses and nothing shared: nothing at all.
    expect(matchSenses('что-то', FOLGE, 'ru')).toEqual([[]]);
  });

  it('ranks senses by shared words, then page order; whole-word parts count', () => {
    const s = [sense(1, ['письменный стол'], []), sense(2, ['стол', 'столик'], []), sense(3, ['стол'], [])];
    expect(matchSenses('стол, столик', s, 'ru')).toEqual([[s[1], s[0], s[2]]]);
  });

  it('tries the other language only when it has as many meanings', () => {
    const s = [sense(1, [], ['house']), sense(2, [], ['home'])];
    expect(matchSenses('здание; жилище', s, 'ru', 'house; home')).toEqual([[s[0]], [s[1]]]);
    expect(matchSenses('здание; жилище', s, 'ru', 'house')).toEqual([[], []]);
    expect(matchSenses('здание', [sense(1, ['дом'], ['house']), sense(2, [], ['home'])], 'ru', 'house')).toEqual([
      [expect.objectContaining({ n: 1 })],
    ]);
  });
});

describe('meaningSentences', () => {
  it('hands out examples a round at a time, each sentence once, within the totals', () => {
    const a = sense(1, [], [], ['A1', 'A2', 'A3']);
    const b = sense(2, [], [], ['A1', 'B1', 'B2']);
    const c = sense(3, [], [], ['C1']);
    expect(meaningSentences([[a], [b], [c]], 2, 6)).toEqual([['A1', 'A2'], ['B1', 'B2'], ['C1']]);
    expect(meaningSentences([[a], [b], [c]], 2, 4)).toEqual([['A1', 'A2'], ['B1'], ['C1']]);
    // A meaning with several senses takes their examples in rank order; [] stays [].
    expect(meaningSentences([[c, a], []], 2, 6)).toEqual([['C1', 'A1'], []]);
  });
});

describe('examples by meaning', () => {
  const TR = (de: string) => ({ de, tr: `TR(${de})` });
  /** Tisch with numbered senses: 1 стол/table, 2 письменный стол, 3 застолье/meal; an idiom and a collocation. */
  const tischSenses = (e: WikiEntry): WikiEntry => ({
    ...e,
    translations: { ru: [['стол'], ['застолье']], en: [['table'], ['meal']] },
    examples: ['Der erste Satz der Seite.', 'Der zweite Satz der Seite.'],
    senses: [
      sense(1, ['стол'], ['table'], ['Der Tisch ist gedeckt.', 'Stell die Vase auf den Tisch.', 'Ein runder Tisch.']),
      sense(2, ['письменный стол'], ['desk'], ['Er sitzt am Tisch und schreibt.']),
      sense(3, ['застолье'], ['meal'], ['Nach Tisch ruhen wir.']),
    ],
    phrases: [{ de: 'reinen Tisch machen', note: 'etwas klären' }, { de: 'am Tisch sitzen' }],
  });

  it('gives each meaning examples of its own sense, and translates idioms\' explanations in the same request', async () => {
    wiki.edit.set('Tisch', tischSenses);
    const { calls } = mockFetch();
    const r = (await lookupWord('Tisch', 'ru'))!;
    expect(r.translation).toBe('стол; застолье');
    expect(r.meaningExamples).toEqual([
      [TR('Der Tisch ist gedeckt.'), TR('Stell die Vase auf den Tisch.')],
      [TR('Nach Tisch ruhen wir.')],
    ]);
    // The card's examples: the first meaning's first, at most 3.
    expect(r.examples).toEqual([TR('Der Tisch ist gedeckt.'), TR('Stell die Vase auf den Tisch.'), TR('Nach Tisch ruhen wir.')]);
    // An idiom gets its explanation's translation; a collocation is never translated word by word.
    expect(r.phrases).toEqual([{ de: 'reinen Tisch machen', tr: 'TR(etwas klären)' }, { de: 'am Tisch sitzen' }]);
    expect(calls.google).toEqual([
      ['Der Tisch ist gedeckt.', 'Stell die Vase auf den Tisch.', 'Nach Tisch ruhen wir.', 'etwas klären'].join('\n'),
    ]);
    // Cached with its new fields.
    expect((mem.cache.get('v5:ru:Tisch') as { result: LookupResult }).result).toEqual(r);
  });

  it('falls back to the page’s first examples when no meaning matches a sense', async () => {
    wiki.edit.set('Tisch', (e) => ({ ...tischSenses(e), translations: { ru: [['мебель']], en: [['furniture']] } }));
    mockFetch();
    const r = (await lookupWord('Tisch', 'ru'))!;
    expect(r.meaningExamples).toEqual([[]]);
    expect(r.examples).toEqual([TR('Der erste Satz der Seite.'), TR('Der zweite Satz der Seite.')]);
  });

  it('works as before for a page without numbered senses', async () => {
    wiki.edit.set('Tisch', (e) => ({ ...e, examples: ['Eins.', 'Zwei.', 'Drei.', 'Vier.'], senses: undefined, phrases: undefined }));
    const { calls } = mockFetch();
    const r = (await lookupWord('Tisch', 'ru'))!;
    expect(r.examples).toEqual([TR('Eins.'), TR('Zwei.'), TR('Drei.')]);
    expect(r).not.toHaveProperty('meaningExamples');
    expect(r).not.toHaveProperty('phrases');
    expect(calls.google).toEqual(['Eins.\nZwei.\nDrei.']);
  });

  it('matches an offline entry through its other language when its own words differ', async () => {
    dict.hits.set('Haus', [{ entry: lex({ ...HAUS_LEX, tr: { ru: 'здание; жилище', en: 'house; home' } }) }]);
    wiki.edit.set('Haus', (e) => ({
      ...e,
      senses: [sense(1, ['дом'], ['house'], ['Das Haus ist alt.']), sense(2, ['дом'], ['home'], ['Ich gehe nach Hause.'])],
    }));
    mockFetch();
    const r = (await lookupWordWithSource('Haus', 'ru')).result!;
    expect(r.translation).toBe('здание; жилище');
    expect(r.meaningExamples).toEqual([[TR('Das Haus ist alt.')], [TR('Ich gehe nach Hause.')]]);
  });

  it('chooses each article’s examples from its own senses', async () => {
    const SEE_M = lex({ term: 'See', pos: 'noun', genders: ['m'], plural: 'Seen', rank: 1112, tr: { ru: 'озеро', en: 'lake' } });
    const SEE_F = lex({ term: 'See', pos: 'noun', genders: ['f'], plural: 'Seen', rank: 2632, tr: { ru: 'море', en: 'sea' } });
    dict.hits.set('See', [{ entry: SEE_M }, { entry: SEE_F }]);
    wiki.edit.set('See', (e) => {
      const [m, f] = e.articles!;
      return {
        ...e,
        phrases: [{ de: 'in See stechen', note: 'losfahren' }],
        articles: [
          { ...m, senses: [sense(1, ['озеро'], ['lake'], ['Der See ist tief.', 'Wir baden im See.', 'Am See.'])] },
          { ...f, senses: [sense(1, ['волна'], ['wave'], ['Hohe See.']), sense(2, ['море'], ['sea'], ['Die See ist rau.'])] },
        ],
      };
    });
    const { calls } = mockFetch();
    const r = (await lookupWord('die See', 'ru'))!;
    const [m, f] = r.articles!;
    expect(m.meaningExamples).toEqual([[TR('Der See ist tief.'), TR('Wir baden im See.')]]);
    expect(f.meaningExamples).toEqual([[TR('Die See ist rau.')]]);
    expect(r).toMatchObject({ genders: ['f'], translation: 'море', examples: [TR('Die See ist rau.')], meaningExamples: f.meaningExamples });
    expect(r.phrases).toEqual([{ de: 'in See stechen', tr: 'TR(losfahren)' }]);
    expect(calls.google).toHaveLength(1);
    // The cached row is der See; "See" reads it with der See's examples.
    const see = (await lookupWord('See', 'ru'))!;
    expect(see).toMatchObject({ genders: ['m'], examples: m.examples, meaningExamples: m.meaningExamples });
    expect(calls.google).toHaveLength(1);
  });

  it('fills cards with the same examples as one lookup per card, in one translation request', async () => {
    wiki.edit.set('Tisch', tischSenses);
    wiki.edit.set('Haus', (e) => ({ ...e, senses: [sense(1, ['дом'], ['house'], ['Das Haus ist alt.'])], phrases: [{ de: 'zu Hause', note: 'daheim' }] }));
    mockFetch();
    const expected = await perCard(storedTerms('Tisch', 'Haus'));
    const expectedCache = cacheRows();
    mem.cache.clear();
    mem.saved.length = 0;
    const { calls } = mockFetch();
    expect(await fillCards(storedTerms('Tisch', 'Haus'), 'ru')).toEqual({ filled: 2, notFound: 0, failed: 0 });
    expect((mem.saved as Card[]).map((c) => ({ ...c, id: 0 }))).toEqual(expected.map((c) => ({ ...c, id: 0 })));
    expect(cacheRows()).toEqual(expectedCache);
    expect(calls.google).toHaveLength(1);
    // Tisch: 3 examples + 1 idiom explanation; Haus: 1 example + 1 explanation.
    expect(calls.google[0].split('\n')).toHaveLength(4 + 2);
    expect((mem.saved as Card[])[0].examples[0]).toEqual(TR('Der Tisch ist gedeckt.'));
  });
});

// ---------- Reflexive verbs ----------

describe('reflexive verbs', () => {
  const TR = (de: string) => ({ de, tr: `TR(${de})` });
  const TREFFEN_LEX = lex({
    term: 'treffen',
    pos: 'verb',
    praeteritum: 'traf',
    partizip2: 'getroffen',
    auxiliary: 'haben',
    tr: { ru: 'встречать; попадать', en: 'meet; hit' },
    reflexive: 'also',
    trRefl: { ru: 'встречаться', en: 'meet up' },
    preps: 'mit + Dat',
  });
  const MEET = 'Die zwei Fußballmannschaften treffen sich auf dem Fußballfeld.';
  const FITS = 'Dass ich heute müde bin, trifft sich gut, wenn du sowieso keine Zeit hast.';

  it('looks up "sich treffen" as the reflexive verb: its translation, examples and prepositions', async () => {
    dict.hits.set('treffen', [{ entry: TREFFEN_LEX }]);
    const { calls } = mockFetch();
    const r = (await lookupWord('sich treffen', 'ru'))!;
    expect(r).toMatchObject({ term: 'sich treffen', pos: 'verb', praeteritum: 'traf', partizip2: 'getroffen', translation: 'встречаться', preps: 'mit + Dat' });
    // Examples of the reflexive senses only ([2], [5]), none of "jemanden treffen".
    expect(r.examples).toEqual([TR(MEET), TR(FITS)]);
    expect(r).not.toHaveProperty('reflexive');
    expect(calls.wiki.map((p) => p.get('page'))).toEqual(['treffen']);
    expect(calls.google).toHaveLength(1);
    expect(mem.cache.get('v5:ru:sich treffen')).toMatchObject({ via: 'local', result: { term: 'sich treffen' } });
  });

  it('asks for the translation of "sich treffen" as a whole when no dictionary has one', async () => {
    const { calls } = mockFetch({ google: (q) => (q === 'sich treffen' ? [[['Встречаться', q]], null, 'de'] : echoGoogle(q, 'ru')) });
    const r = (await lookupWord('sich treffen', 'ru'))!;
    expect(r).toMatchObject({ term: 'sich treffen', pos: 'verb', translation: 'встречаться', source: 'wiktionary' });
    expect(r.examples).toEqual([TR(MEET), TR(FITS)]);
    expect(calls.google).toEqual(['sich treffen', [MEET, FITS].join('\n')]);
  });

  it('gives "treffen" its other meanings plus the reflexive reading, in one translation request', async () => {
    dict.hits.set('treffen', [{ entry: TREFFEN_LEX }]);
    const { calls } = mockFetch();
    const r = (await lookupWord('treffen', 'ru'))!;
    expect(r.term).toBe('treffen');
    expect(r.translation).toBe('встречать; попадать');
    // The offline prepositions belong to the reflexive reading.
    expect(r).not.toHaveProperty('preps');
    expect(r.examples.map((e) => e.de)).not.toContain(MEET);
    // встречаться matches no sense (the page translates none of them): the reflexive senses' examples.
    expect(r.reflexive).toEqual({ translation: 'встречаться', examples: [TR(MEET), TR(FITS)], meaningExamples: [[]], preps: 'mit + Dat' });
    expect(calls.google).toHaveLength(1);
    const lines = calls.google[0].split('\n');
    expect(lines).toEqual(expect.arrayContaining([MEET, FITS, ...r.examples.map((e) => e.de)]));
    expect(lines.length).toBeLessThanOrEqual(6 + 3 + 3);
    // Cached with its reflexive reading, apart from "sich treffen".
    expect((mem.cache.get('v5:ru:treffen') as { result: LookupResult }).result).toEqual(r);
    expect(mem.cache.has('v5:ru:sich treffen')).toBe(false);
  });

  it('translates the reflexive reading with the examples when only Wiktionary knows the verb', async () => {
    const { calls } = mockFetch();
    const r = (await lookupWord('treffen', 'ru'))!;
    expect(r.translation).toBe('встретить; попадать');
    expect(r.meaningExamples![0].map((e) => e.de)).toContain('Sie am Wochenende zu treffen ist schwierig.');
    expect(r.examples.map((e) => e.de)).not.toContain(MEET);
    // "sich treffen" goes in the examples' request: no request of its own.
    expect(r.reflexive).toEqual({ translation: 'TR(sich treffen)', examples: [TR(MEET), TR(FITS)] });
    expect(calls.google).toHaveLength(1);
    expect(calls.google[0].split('\n')).toContain('sich treffen');
  });

  it('gives a reflexive-only verb as "sich …" (beeilen → sich beeilen)', async () => {
    const { calls } = mockFetch();
    const r = (await lookupWord('beeilen', 'ru'))!;
    expect(r).toMatchObject({ term: 'sich beeilen', pos: 'verb', praeteritum: 'beeilte', partizip2: 'beeilt', auxiliary: 'haben' });
    expect(r.translation).toBe('торопиться, спешить');
    expect(r.preps).toBe('mit + Dat');
    expect(r).not.toHaveProperty('reflexive');
    expect(r.examples[0]).toEqual(TR('Sie mussten sich sehr beeilen, um den Bus noch zu erreichen.'));
    expect(calls.google).toHaveLength(1);
    // Typed with "sich", the same reading.
    const typed = (await lookupWord('sich beeilen', 'ru'))!;
    expect(typed).toEqual(r);
  });

  it('takes a reading’s prepositions from the senses its meanings stand for (sich freuen)', async () => {
    mockFetch();
    const r = (await lookupWord('freuen', 'ru'))!;
    expect(r.reflexive).toMatchObject({ translation: 'радоваться', preps: 'über + Akk; auf + Akk' });
    expect(r.reflexive!.examples[0]).toEqual(TR('Peter freut sich über sein gutes Schulzeugnis. Herbert aber freute sich dessen nicht.'));
    // "freuen" alone: "es freut mich" ([3]), whose examples it gets.
    expect(r.examples[0]).toEqual(TR('Es freut mich außerordentlich, dass Sie heute erscheinen konnten.'));
    expect(r).not.toHaveProperty('preps');
    const refl = (await lookupWord('sich freuen', 'ru'))!;
    expect(refl).toMatchObject({ term: 'sich freuen', translation: 'радоваться', preps: 'über + Akk; auf + Akk' });
  });

  it('fills imported "sich …" cards as the reflexive verb, with prepositions, as one lookup per card would', async () => {
    dict.hits.set('treffen', [{ entry: TREFFEN_LEX }]);
    mockFetch();
    const expected = await perCard(storedTerms('sich freuen', 'treffen', 'sich treffen'));
    const expectedCache = cacheRows();
    mem.cache.clear();
    mem.saved.length = 0;
    const { calls } = mockFetch();
    expect(await fillCards(storedTerms('sich freuen', 'treffen', 'sich treffen'), 'ru')).toEqual({ filled: 3, notFound: 0, failed: 0 });
    const saved = mem.saved as Card[];
    expect(saved.map((c) => ({ ...c, id: 0 }))).toEqual(expected.map((c) => ({ ...c, id: 0 })));
    expect(cacheRows()).toEqual(expectedCache);
    expect(Object.keys(expectedCache).sort()).toEqual(['v5:ru:sich freuen', 'v5:ru:sich treffen', 'v5:ru:treffen']);
    expect(saved.map((c) => [c.term, c.pos, c.translation, c.preps])).toEqual([
      ['sich freuen', 'verb', 'радоваться', 'über + Akk; auf + Akk'],
      ['treffen', 'verb', 'встречать; попадать', undefined],
      ['sich treffen', 'verb', 'встречаться', 'mit + Dat'],
    ]);
    // One page request and one translation request for all three.
    expect(calls.wiki).toHaveLength(1);
    expect(calls.google).toHaveLength(1);
  });

  it('keeps the card’s own prepositions when merging', () => {
    const card = { ...storedTerms('sich freuen')[0], preps: 'auf + Akk' };
    const result = { term: 'sich freuen', pos: 'verb', genders: [], plural: '', praeteritum: '', partizip2: '', auxiliary: '', translation: 'x', examples: [], preps: 'über + Akk', source: 'wiktionary' } as LookupResult;
    expect(mergeIntoCard(card, result).preps).toBe('auf + Akk');
    expect(mergeIntoCard({ ...card, preps: undefined }, result).preps).toBe('über + Akk');
    expect(mergeIntoCard(storedTerms('Tisch')[0], { ...result, preps: undefined })).not.toHaveProperty('preps');
  });
});
