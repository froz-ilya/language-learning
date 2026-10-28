import type { LevelCode } from '../../levels/types';
import type { Article, ArticleSummary, ReadingSourceInfo } from '../types';
import { htmlToParagraphs, stripTags } from '../text';
import type { ListOptions, ListResult, Source } from './types';
import { mwGet, parsePage, SourceError, wikiUrl, type RandomResponse, type SearchResponse } from './mediawiki';

/**
 * Klexikon (children's encyclopedia) and MiniKlexikon (easy language), both MediaWiki sites
 * without TextExtracts. Lists for a level come from the bundled level catalog
 * (public/reading/klexikon.json, built by scripts/reading/klexikon.mjs, every article rated with
 * the reader's own estimate); search goes to the live API (list=search), and so do the lists
 * when the catalog can't be loaded (list=random). The text comes from action=parse HTML.
 */

export type CatalogSourceId = 'miniklexikon' | 'klexikon';

/** public/reading/klexikon.json: per source and level, [title, word count] rows. */
export interface CatalogFile {
  version: number;
  generated: string;
  license: string;
  sources: Partial<Record<CatalogSourceId, Partial<Record<LevelCode, [string, number][]>>>>;
}

export interface CatalogEntry {
  title: string;
  level: LevelCode;
  words: number;
}

interface Catalog {
  /** Per source and level, in a varied order (shuffled once per session). */
  lists: Map<string, CatalogEntry[]>;
  /** Per source: title → entry. */
  byTitle: Map<CatalogSourceId, Map<string, CatalogEntry>>;
}

const PAGE = 20;
const LEVEL_RE = /^[ABC][12]$/;
/** Cursor prefixes: catalog offset vs the API's random continue token (fallback). */
const CATALOG_CURSOR = 'c:';
const RANDOM_CURSOR = 'r:';

let cache: Promise<Catalog> | undefined;
let random: () => number = Math.random;

/** Fisher–Yates with the session's random source. */
function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function parseCatalog(data: CatalogFile): Catalog {
  if (!data || typeof data !== 'object' || !data.sources || typeof data.sources !== 'object') {
    throw new SourceError('Invalid klexikon.json');
  }
  const lists = new Map<string, CatalogEntry[]>();
  const byTitle = new Map<CatalogSourceId, Map<string, CatalogEntry>>();
  for (const [source, levels] of Object.entries(data.sources) as [CatalogSourceId, CatalogFile['sources'][CatalogSourceId]][]) {
    const titles = new Map<string, CatalogEntry>();
    for (const [level, rows] of Object.entries(levels ?? {}) as [LevelCode, [string, number][]][]) {
      if (!LEVEL_RE.test(level) || !Array.isArray(rows)) continue;
      const entries: CatalogEntry[] = [];
      for (const r of rows) {
        if (!Array.isArray(r) || typeof r[0] !== 'string' || !r[0]) continue;
        const e: CatalogEntry = { title: r[0], level, words: Number(r[1]) || 0 };
        entries.push(e);
        titles.set(e.title, e);
      }
      lists.set(`${source}/${level}`, shuffled(entries));
    }
    byTitle.set(source, titles);
  }
  return { lists, byTitle };
}

/** The bundled catalog (fetched once per session; the service worker caches it for offline use). */
export function loadCatalog(fetchImpl: typeof fetch = fetch): Promise<Catalog> {
  cache ??= (async () => {
    const res = await fetchImpl(`${import.meta.env.BASE_URL}reading/klexikon.json`);
    if (!res.ok) throw new SourceError(`HTTP ${res.status}`, res.status);
    return parseCatalog((await res.json()) as CatalogFile);
  })();
  cache.catch(() => (cache = undefined));
  return cache;
}

/** For tests: forget the loaded catalog (and optionally use a fixed random source for the order). */
export function resetCatalogCache(rand: () => number = Math.random) {
  cache = undefined;
  random = rand;
}

/** The catalog's entry for an article ("Hund" or the title after a redirect), or null. */
export async function catalogEntry(source: CatalogSourceId, ...titles: string[]): Promise<CatalogEntry | null> {
  try {
    const { byTitle } = await loadCatalog();
    const map = byTitle.get(source);
    for (const t of titles) {
      const e = map?.get(t) ?? map?.get(t.replace(/_/g, ' '));
      if (e) return e;
    }
  } catch {
    // No catalog (offline before it was cached): no level known.
  }
  return null;
}

export function klexikonSource(info: ReadingSourceInfo, host: string): Source {
  const source = info.id as CatalogSourceId;
  const api = `https://${host}/api.php`;
  const wiki = `https://${host}/wiki/`;
  const prefix = `${info.id}:`;

  async function search(query: string, opts: ListOptions): Promise<ListResult> {
    const data = await mwGet<SearchResponse>(
      api,
      { action: 'query', list: 'search', srsearch: query, srnamespace: 0, srlimit: 20, srprop: 'snippet', sroffset: opts.cursor },
      opts.signal,
    );
    const levels = await catalogEntries(data.query?.search?.map((r) => r.title) ?? []);
    const items: ArticleSummary[] = (data.query?.search ?? []).map((r) => {
      const item: ArticleSummary = {
        id: prefix + r.title,
        source: info.id,
        title: r.title,
        snippet: r.snippet ? stripTags(r.snippet) : undefined,
      };
      const e = levels.get(r.title);
      if (e) Object.assign(item, { level: e.level, words: e.words });
      return item;
    });
    const next = data.continue?.sroffset;
    return { items, cursor: next !== undefined ? String(next) : undefined };
  }

  /** Catalog rows for search hits (none when the catalog isn't available). */
  async function catalogEntries(titles: string[]): Promise<Map<string, CatalogEntry>> {
    const out = new Map<string, CatalogEntry>();
    try {
      const map = (await loadCatalog()).byTitle.get(source);
      for (const t of titles) {
        const e = map?.get(t);
        if (e) out.set(t, e);
      }
    } catch {
      // Search still works without levels.
    }
    return out;
  }

  /** A page of the catalog for a level (offset cursor). */
  function fromCatalog(catalog: Catalog, level: LevelCode, offset: number): ListResult {
    const list = catalog.lists.get(`${source}/${level}`) ?? [];
    const items: ArticleSummary[] = list.slice(offset, offset + PAGE).map((e) => ({
      id: prefix + e.title,
      source: info.id,
      title: e.title,
      level: e.level,
      words: e.words,
    }));
    const next = offset + PAGE;
    return { items, cursor: next < list.length ? CATALOG_CURSOR + next : undefined };
  }

  /** Random articles from the live API (no level known): used when the catalog is unavailable. */
  async function randomPage(cursor: string | undefined, signal?: AbortSignal): Promise<ListResult> {
    const data = await mwGet<RandomResponse>(
      api,
      { action: 'query', list: 'random', rnnamespace: 0, rnfilterredir: 'nonredirects', rnlimit: 20, rncontinue: cursor },
      signal,
    );
    const items: ArticleSummary[] = (data.query?.random ?? []).map((r) => ({ id: prefix + r.title, source: info.id, title: r.title }));
    const next = data.continue?.rncontinue;
    return { items, cursor: next ? RANDOM_CURSOR + next : undefined };
  }

  async function list(opts: ListOptions = {}): Promise<ListResult> {
    const query = opts.query?.trim();
    if (query) return search(query, opts);
    const cursor = opts.cursor ?? '';
    if (opts.level && !cursor.startsWith(RANDOM_CURSOR)) {
      let catalog: Catalog | null = null;
      try {
        catalog = await loadCatalog();
      } catch (e) {
        console.warn(`[reading] ${info.id}: no catalog, listing random articles`, e);
      }
      if (catalog) {
        const offset = cursor.startsWith(CATALOG_CURSOR) ? Number(cursor.slice(CATALOG_CURSOR.length)) || 0 : 0;
        return fromCatalog(catalog, opts.level, offset);
      }
    }
    return randomPage(cursor.startsWith(RANDOM_CURSOR) ? cursor.slice(RANDOM_CURSOR.length) : undefined, opts.signal);
  }

  async function get(key: string, signal?: AbortSignal): Promise<Article> {
    const { title, html } = await parsePage(api, key, signal);
    const paragraphs = htmlToParagraphs(html);
    return {
      id: prefix + key,
      source: info.id,
      title,
      paragraphs,
      url: wikiUrl(wiki, title),
      license: info.license,
      attribution: `${info.name} · ${info.license}`,
    };
  }

  return { info, list, get };
}
