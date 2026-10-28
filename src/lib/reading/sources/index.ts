import type { LevelCode } from '../../levels/types';
import { db } from '../../db/schema';
import type { Article, ArticleSummary, ReadingSourceId, ReadingSourceInfo } from '../types';
import { firstSentence, isHeading } from '../text';
import type { ListOptions, ListResult, Source } from './types';
import { catalogEntry, klexikonSource } from './klexikon';
import { wikinewsSource } from './wikinews';
import { wikipediaSource } from './wikipedia';
import { gutenbergSource, GUTENBERG_LICENSE, loadGutenberg } from './gutenberg';
import { SourceError } from './mediawiki';
import CATALOG_LEVELS from './klexikon-levels.json';

export type { ListOptions, ListResult } from './types';
export { SourceError } from './mediawiki';

/**
 * Levels: where each source has articles. MiniKlexikon/Klexikon: the levels of the bundled
 * catalog with at least 20 articles (klexikon-levels.json, written by the catalog build).
 * Wikinews/Wikipedia: where their intros usually rate (lists are filtered per batch).
 */
export const READING_SOURCES: ReadingSourceInfo[] = [
  {
    id: 'miniklexikon',
    name: 'MiniKlexikon',
    levels: CATALOG_LEVELS.miniklexikon as LevelCode[],
    license: 'CC BY-SA 4.0',
    homepage: 'https://miniklexikon.zum.de/',
  },
  {
    id: 'klexikon',
    name: 'Klexikon',
    levels: CATALOG_LEVELS.klexikon as LevelCode[],
    license: 'CC BY-SA 4.0',
    homepage: 'https://klexikon.zum.de/',
  },
  {
    id: 'gutenberg',
    name: 'Project Gutenberg',
    levels: ['B1', 'B2', 'C1', 'C2'],
    license: GUTENBERG_LICENSE,
    homepage: 'https://www.gutenberg.org/',
  },
  {
    id: 'wikinews',
    name: 'Wikinews',
    levels: ['B2', 'C1'],
    license: 'CC BY 2.5',
    homepage: 'https://de.wikinews.org/',
  },
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    levels: ['B2', 'C1', 'C2'],
    license: 'CC BY-SA 4.0',
    homepage: 'https://de.wikipedia.org/',
  },
  {
    id: 'paste',
    name: 'Your text',
    levels: [],
    license: '',
    homepage: '',
  },
];

/** License deeds, for the attribution line. */
export const LICENSE_URLS: Record<string, string> = {
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/deed.de',
  'CC BY 2.5': 'https://creativecommons.org/licenses/by/2.5/deed.de',
};

export function sourceInfo(id: ReadingSourceId): ReadingSourceInfo {
  return READING_SOURCES.find((s) => s.id === id) ?? READING_SOURCES[READING_SOURCES.length - 1];
}

/** Sources with articles for a level (in display order). */
export function sourcesForLevel(level: LevelCode): ReadingSourceInfo[] {
  return READING_SOURCES.filter((s) => s.levels.includes(level));
}

const info = (id: ReadingSourceId) => READING_SOURCES.find((s) => s.id === id)!;

/** Your own pasted texts, from IndexedDB. */
const pasteSource: Source = {
  info: info('paste'),
  async list(opts: ListOptions = {}): Promise<ListResult> {
    const q = opts.query?.trim().toLowerCase();
    const rows = (await db.articles.where('source').equals('paste').toArray())
      .filter((a) => !q || a.title.toLowerCase().includes(q))
      .sort((a, b) => b.savedAt - a.savedAt);
    return {
      items: rows.map((a) => ({
        id: a.id,
        source: 'paste',
        title: a.title,
        snippet: firstSentence(a.paragraphs.find((p) => !isHeading(p)) ?? ''),
        level: a.level || undefined,
      })),
    };
  },
  async get(key: string): Promise<Article> {
    const row = await db.articles.get(`paste:${key}`);
    if (!row) throw new SourceError('This text was deleted', 404);
    return row;
  },
};

const SOURCES: Record<ReadingSourceId, Source> = {
  miniklexikon: klexikonSource(info('miniklexikon'), 'miniklexikon.zum.de'),
  klexikon: klexikonSource(info('klexikon'), 'klexikon.zum.de'),
  wikinews: wikinewsSource(info('wikinews')),
  wikipedia: wikipediaSource(info('wikipedia')),
  gutenberg: gutenbergSource(info('gutenberg')),
  paste: pasteSource,
};

/** "klexikon:Hund" → ['klexikon', 'Hund']. */
export function splitArticleId(id: string): { source: ReadingSourceId; key: string } {
  const i = id.indexOf(':');
  const source = id.slice(0, i) as ReadingSourceId;
  if (i < 0 || !(source in SOURCES)) throw new SourceError(`Unknown article “${id}”`, 404);
  return { source, key: id.slice(i + 1) };
}

/** Levels the lists showed this session (article id → level), so the reader can show the same. */
const listedLevels = new Map<string, LevelCode>();

/** Articles from one source (network; throws on failure so callers can try another source). */
export async function listArticles(
  source: ReadingSourceId,
  opts?: ListOptions,
): Promise<{ items: ArticleSummary[]; cursor?: string }> {
  const r = await SOURCES[source].list(opts);
  for (const i of r.items) if (i.level) listedLevels.set(i.id, i.level);
  return r;
}

/**
 * The level an article has without the reader's own estimate: the catalog level
 * (MiniKlexikon/Klexikon), the bundled level (Gutenberg), or the level its list showed this
 * session (Wikinews/Wikipedia, rated from the intro). Null when none is known: the reader then
 * estimates from the full text.
 */
export async function knownLevel(id: string, title?: string): Promise<LevelCode | null> {
  let source: ReadingSourceId;
  let key: string;
  try {
    ({ source, key } = splitArticleId(id));
  } catch {
    return null;
  }
  const titles = title && title !== key ? [key, title] : [key];
  if (source === 'miniklexikon' || source === 'klexikon') {
    const e = await catalogEntry(source, ...titles);
    if (e) return e.level;
  } else if (source === 'gutenberg') {
    try {
      const t = (await loadGutenberg()).texts.find((x) => x.id === key);
      if (t) return t.level;
    } catch {
      // Not loaded: fall through.
    }
  }
  return listedLevels.get(id) ?? null;
}

/** For tests: forget the levels the lists showed. */
export function resetListedLevels() {
  listedLevels.clear();
}

/** Full text of an article: from db.articles if saved, otherwise from its source. */
export async function getArticle(id: string, signal?: AbortSignal): Promise<Article> {
  try {
    const row = await db.articles.get(id);
    if (row?.paragraphs?.length) return row;
  } catch {
    // IndexedDB unavailable: fetch from the source.
  }
  const { source, key } = splitArticleId(id);
  return SOURCES[source].get(key, signal);
}
