// Klexikon/MiniKlexikon level catalog: the build (scripts/reading/klexikon.mjs and lib/) rates
// articles exactly like the app, and the app lists articles for a level from the catalog.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCatalog, rateArticle } from '../../../scripts/reading/lib/catalog.mjs';
import { loadShared } from '../../../scripts/reading/lib/shared.mjs';
import { estimateLevel } from './level';
import { lemmaMap, paragraphTokens, rankLookup, rateParagraphs } from './rate';
import { getArticle, knownLevel, listArticles, READING_SOURCES, resetListedLevels } from './sources';
import { resetCatalogCache, type CatalogFile } from './sources/klexikon';
import { countWords, isHeading } from './text';
import { wikitextToParagraphs } from './wikitext';
import type { LevelCode } from '../levels/types';

const ROOT = path.join(__dirname, '../../..');
const FIXTURES = path.join(__dirname, '__fixtures__');
const wikitext = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'klexikon-wikitext.json'), 'utf8')) as Record<
  'miniklexikon' | 'klexikon',
  { title: string; wikitext: string }[]
>;
const APP = { wikitextToParagraphs, rateParagraphs, countWords, isHeading };

/** Serves the real offline dictionary (public/dict) and `files` by path; records other requests. */
function serve(files: Record<string, unknown>, api: (url: URL) => unknown = () => new Response('', { status: 500 })) {
  const calls: URL[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost/');
    const dict = /\/dict\/([\w.-]+\.json)$/.exec(url.pathname);
    if (dict) {
      const f = path.join(ROOT, 'public/dict', dict[1]);
      return fs.existsSync(f) ? new Response(fs.readFileSync(f, 'utf8')) : new Response('', { status: 404 });
    }
    calls.push(url);
    for (const [suffix, body] of Object.entries(files)) {
      if (url.pathname.endsWith(suffix)) return body instanceof Response ? body : new Response(JSON.stringify(body));
    }
    const body = api(url);
    return body instanceof Response ? body : new Response(JSON.stringify(body));
  });
  return calls;
}

/** Deterministic "random" for the shuffled order. */
function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

const titles = (n: number, prefix: string): [string, number][] => Array.from({ length: n }, (_, i) => [`${prefix} ${String(i).padStart(2, '0')}`, 100 + i]);

const CATALOG: CatalogFile = {
  version: 1,
  generated: '2026-10-28',
  license: 'CC BY-SA 4.0',
  sources: {
    miniklexikon: { A1: titles(45, 'Mini A1'), B1: [['Hund', 120]] },
    klexikon: { B1: [['Hunde', 300]], B2: titles(3, 'Klex B2') },
  },
};

beforeEach(() => {
  resetCatalogCache(seeded());
  resetListedLevels();
});
afterEach(() => vi.unstubAllGlobals());

describe('catalog build (scripts/reading/lib/catalog.mjs)', () => {
  it('rates an article exactly like the reader does (same paragraphs, tokens, lemmas, estimate)', async () => {
    serve({});
    for (const page of [...wikitext.miniklexikon, ...wikitext.klexikon].filter((p) => p.title !== 'Kurz')) {
      const row = await rateArticle(page, APP);
      // The reader's pipeline (Reader.svelte): tokens per paragraph → lemma map → estimateLevel.
      const paragraphs = wikitextToParagraphs(page.wikitext);
      const tokens = paragraphTokens(paragraphs);
      const reader = estimateLevel(tokens.flat(), rankLookup(await lemmaMap(tokens)));
      expect(reader).not.toBeNull();
      expect(row).toEqual({ title: page.title, level: reader, words: expect.any(Number) });
      expect(row!.words).toBeGreaterThanOrEqual(40);
    }
  });

  it('the build script loads the very same app modules through Vite and gets the same levels', async () => {
    const realFetch = globalThis.fetch;
    try {
      const shared = await loadShared(ROOT);
      const script = await buildCatalog(wikitext, shared, { generated: 'x' });
      serve({});
      const app = await buildCatalog(wikitext, APP, { generated: 'x' });
      expect(script).toEqual(app);
    } finally {
      globalThis.fetch = realFetch;
    }
  }, 30_000);

  it('builds a compact catalog: per source and level, sorted [title, words] rows, stubs skipped', async () => {
    serve({});
    const c = (await buildCatalog(wikitext, APP, { generated: '2026-10-28' })) as CatalogFile;
    expect(c).toMatchObject({ version: 1, generated: '2026-10-28', license: 'CC BY-SA 4.0' });
    const mini = Object.values(c.sources.miniklexikon!).flat() as [string, number][];
    expect(mini.map((r) => r[0]).sort()).toEqual(['Mars', 'Merkur']); // "Kurz" is a stub
    for (const rows of Object.values(c.sources.klexikon!) as [string, number][][]) {
      expect(rows.map((r) => r[0])).toEqual(rows.map((r) => r[0]).sort());
    }
  });
});

describe('committed public/reading/klexikon.json', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'public/reading/klexikon.json'), 'utf8');
  const data = JSON.parse(raw) as CatalogFile;

  it('is valid and small', () => {
    expect(raw.length).toBeLessThan(300 * 1024);
    expect(data.version).toBe(1);
    for (const id of ['miniklexikon', 'klexikon'] as const) {
      const levels = data.sources[id]!;
      const seen = new Set<string>();
      let n = 0;
      for (const [level, rows] of Object.entries(levels)) {
        expect(level).toMatch(/^[ABC][12]$/);
        for (const [title, words] of rows!) {
          expect(seen.has(title)).toBe(false);
          seen.add(title);
          expect(words).toBeGreaterThanOrEqual(40);
          n++;
        }
      }
      expect(n).toBeGreaterThan(1000);
    }
  });

  it('is calibrated: easy-language MiniKlexikon mostly A1–A2, children’s Klexikon mostly A2–B1', () => {
    const share = (id: 'miniklexikon' | 'klexikon', levels: string[]) => {
      const byLevel = data.sources[id]!;
      const total = Object.values(byLevel).reduce((n, rows) => n + rows!.length, 0);
      return levels.reduce((n, l) => n + (byLevel[l as LevelCode]?.length ?? 0), 0) / total;
    };
    expect(share('miniklexikon', ['A1', 'A2'])).toBeGreaterThan(0.7);
    expect(share('miniklexikon', ['B2', 'C1', 'C2'])).toBeLessThan(0.05);
    expect(share('klexikon', ['A2', 'B1'])).toBeGreaterThan(0.75);
    expect(share('klexikon', ['C1', 'C2'])).toBeLessThan(0.02);
  });

  it('the sources are listed at exactly the levels where the catalog has ≥20 articles', () => {
    for (const id of ['miniklexikon', 'klexikon'] as const) {
      const withArticles = Object.entries(data.sources[id]!)
        .filter(([, rows]) => rows!.length >= 20)
        .map(([l]) => l);
      expect(READING_SOURCES.find((s) => s.id === id)!.levels).toEqual(withArticles);
    }
  });
});

describe('catalog lists in the app', () => {
  it('lists only articles of the level, 20 per page, with level and length, loading the file once', async () => {
    const calls = serve({ '/reading/klexikon.json': CATALOG });
    const p1 = await listArticles('miniklexikon', { level: 'A1' });
    expect(p1.items).toHaveLength(20);
    expect(p1.items.every((i) => i.level === 'A1' && i.source === 'miniklexikon' && i.id === `miniklexikon:${i.title}`)).toBe(true);
    expect(p1.items[0].words).toBeGreaterThanOrEqual(100);
    expect(p1.cursor).toBe('c:20');
    const p2 = await listArticles('miniklexikon', { level: 'A1', cursor: p1.cursor });
    const p3 = await listArticles('miniklexikon', { level: 'A1', cursor: p2.cursor });
    expect(p3.items).toHaveLength(5);
    expect(p3.cursor).toBeUndefined();
    const all = [...p1.items, ...p2.items, ...p3.items].map((i) => i.title);
    expect(new Set(all).size).toBe(45);
    // A varied order, not the alphabetical file order.
    expect(all).not.toEqual([...all].sort());
    expect((await listArticles('klexikon', { level: 'B1' })).items).toEqual([
      { id: 'klexikon:Hunde', source: 'klexikon', title: 'Hunde', level: 'B1', words: 300 },
    ]);
    expect((await listArticles('klexikon', { level: 'A1' })).items).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0].pathname).toMatch(/\/reading\/klexikon\.json$/);
  });

  it('keeps the same order for the session (going back to the list shows the same articles)', async () => {
    serve({ '/reading/klexikon.json': CATALOG });
    const a = await listArticles('miniklexikon', { level: 'A1' });
    const b = await listArticles('miniklexikon', { level: 'A1' });
    expect(b.items).toEqual(a.items);
  });

  it('falls back to random articles from the API when the catalog is unavailable', async () => {
    const calls = serve({ '/reading/klexikon.json': new Response('', { status: 404 }) }, (u) =>
      u.searchParams.get('list') === 'random'
        ? { continue: { rncontinue: '0.81|0.82|7212|0' }, query: { random: [{ id: 1, ns: 0, title: 'Aachen' }] } }
        : new Response('', { status: 500 }),
    );
    const r = await listArticles('klexikon', { level: 'A2' });
    expect(r.items).toEqual([{ id: 'klexikon:Aachen', source: 'klexikon', title: 'Aachen' }]);
    expect(r.cursor).toBe('r:0.81|0.82|7212|0');
    const api = calls.filter((u) => u.hostname === 'klexikon.zum.de');
    expect(api).toHaveLength(1);
    expect(api[0].searchParams.get('rnnamespace')).toBe('0');
    expect(api[0].searchParams.get('rnfilterredir')).toBe('nonredirects');
    await listArticles('klexikon', { level: 'A2', cursor: r.cursor });
    const next = calls.filter((u) => u.hostname === 'klexikon.zum.de');
    expect(next[1].searchParams.get('rncontinue')).toBe('0.81|0.82|7212|0');
  });

  it('search stays live and adds the catalog level where known', async () => {
    const calls = serve({ '/reading/klexikon.json': CATALOG }, () => ({
      query: { search: [{ title: 'Hund', snippet: 'Der <b>Hund</b>' }, { title: 'Neu', snippet: '' }] },
    }));
    const r = await listArticles('miniklexikon', { query: 'Hund', level: 'A1' });
    expect(calls.some((u) => u.hostname === 'miniklexikon.zum.de' && u.searchParams.get('srsearch') === 'Hund')).toBe(true);
    expect(r.items).toEqual([
      { id: 'miniklexikon:Hund', source: 'miniklexikon', title: 'Hund', snippet: 'Der Hund', level: 'B1', words: 120 },
      { id: 'miniklexikon:Neu', source: 'miniklexikon', title: 'Neu', snippet: undefined },
    ]);
  });

  it('the reader gets the catalog level (also after a redirect), not its own estimate', async () => {
    serve({ '/reading/klexikon.json': CATALOG });
    expect(await knownLevel('klexikon:Hunde')).toBe('B1');
    expect(await knownLevel('klexikon:Hund', 'Hunde')).toBe('B1');
    expect(await knownLevel('miniklexikon:Hunde')).toBeNull();
    expect(await knownLevel('wikipedia:Hund')).toBeNull();
  });

  it('the reader shows the level a live list showed this session', async () => {
    serve({ '/reading/klexikon.json': CATALOG }, () => fixtureJson('wikinews-intros.json'));
    const level = await firstRatedLevel();
    const r = await listArticles('wikinews', { level });
    expect(r.items.length).toBeGreaterThan(0);
    expect(await knownLevel(r.items[0].id)).toBe(level);
  });
});

const fixtureJson = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));

/** The rated level of the first page of the Wikinews fixture. */
async function firstRatedLevel(): Promise<LevelCode> {
  const { newsText } = await import('./sources/wikinews');
  const p = fixtureJson('wikinews-intros.json').query.pages[0];
  return (await rateParagraphs(newsText(p.title, p.extract), p.title))!;
}

describe('live lists are filtered by level per batch', () => {
  it('Wikinews: one request, every item rated from its intro, only the chosen level kept', async () => {
    const { newsText } = await import('./sources/wikinews');
    const calls = serve({}, () => fixtureJson('wikinews-intros.json'));
    const pages = fixtureJson('wikinews-intros.json').query.pages as { title: string; extract: string }[];
    const levels = await Promise.all(pages.map((p) => rateParagraphs(newsText(p.title, p.extract), p.title)));
    expect(new Set(levels).size).toBeGreaterThan(1); // the fixture mixes levels
    for (const level of new Set(levels)) {
      calls.length = 0;
      const r = await listArticles('wikinews', { level: level! });
      expect(calls).toHaveLength(1);
      expect(calls[0].searchParams.get('exintro')).toBe('1');
      expect(calls[0].searchParams.has('exsentences')).toBe(false); // the whole intro, to rate
      const expected = pages.filter((_, i) => levels[i] === level).map((p) => p.title);
      expect(r.items.map((i) => i.title).sort()).toEqual(expected.sort());
      expect(r.items.every((i) => i.level === level)).toBe(true);
      expect(r.cursor).toBe('20261020101010|99999'); // the next batch comes with "Load more"
    }
    // A level nothing matches: an empty page that can still continue.
    const none = (['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as LevelCode[]).find((l) => !levels.includes(l))!;
    const r = await listArticles('wikinews', { level: none });
    expect(r.items).toEqual([]);
    expect(r.cursor).toBeDefined();
  });

  it('Wikipedia: rated intros, filtered by level, one request per call', async () => {
    const pages = fixtureJson('wikinews-intros.json').query.pages as { pageid: number; title: string; extract: string }[];
    const calls = serve({}, () => ({ continue: { gcmcontinue: 'x|1' }, query: { pages } }));
    const all = await listArticles('wikipedia', {});
    expect(calls).toHaveLength(1);
    expect(calls[0].searchParams.has('exsentences')).toBe(false);
    expect(all.items).toHaveLength(pages.length);
    const level = all.items[0].level!;
    expect(level).toBeDefined();
    const filtered = await listArticles('wikipedia', { level });
    expect(calls).toHaveLength(2);
    expect(filtered.items.map((i) => i.id)).toEqual(all.items.filter((i) => i.level === level).map((i) => i.id));
  });

  it('an article is still fetched in full for the reader', async () => {
    serve({}, () => fixtureJson('klexikon-parse-Hund.json'));
    const a = await getArticle('klexikon:Hund');
    expect(a.paragraphs.length).toBeGreaterThan(3);
  });
});
