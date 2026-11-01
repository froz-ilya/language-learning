import { locale, t } from '../i18n.svelte';
import type { LevelCode } from '../levels/types';
import type { ArticleSummary, NewsTopic, ReadingSourceId } from './types';
import { listArticles, NEWS_SOURCE_IDS, SourceError, sourceInfo, sourcesForLevel } from './sources';

/**
 * Article lists of the Read tab, per level, kept for the session so going back from the reader
 * doesn't refetch (one request per source per user action).
 */
export type FeedError = '' | 'offline' | 'unavailable';

export interface SourceFeed {
  items: ArticleSummary[];
  cursor?: string;
  /** A page was loaded and there's nothing more. */
  done: boolean;
  loading: boolean;
  /** Last error (the other sources still show). */
  error: FeedError;
}

export interface LevelFeed {
  level: LevelCode;
  sources: Partial<Record<ReadingSourceId, SourceFeed>>;
}

export const feeds = $state<Partial<Record<LevelCode, LevelFeed>>>({});
/** What's chosen on the Read tab this session: level (null until picked), view, news filters. */
export const readUi = $state({
  level: null as LevelCode | null,
  view: 'articles' as 'articles' | 'news',
  newsSource: '' as ReadingSourceId | '',
  newsTopic: '' as NewsTopic | '',
});

function feedFor(level: LevelCode): LevelFeed {
  let f = feeds[level];
  if (!f) {
    const sources: LevelFeed['sources'] = {};
    for (const s of sourcesForLevel(level)) sources[s.id] = { items: [], done: false, loading: false, error: '' };
    feeds[level] = { level, sources };
    f = feeds[level]!;
  }
  return f;
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** Load the first page (if not loaded yet) or, with `more`, the next page of every source. */
export async function loadFeed(level: LevelCode, more = false): Promise<void> {
  const feed = feedFor(level);
  const jobs = (Object.keys(feed.sources) as ReadingSourceId[]).flatMap((id) => {
    const s = feed.sources[id]!;
    if (s.loading || s.done) return [];
    if (!more && (s.items.length || s.error)) return [];
    if (more && !s.cursor && s.items.length) return [];
    return [id];
  });
  await Promise.allSettled(
    jobs.map(async (id) => {
      const s = feed.sources[id]!;
      s.loading = true;
      s.error = '';
      try {
        const r = await listArticles(id, { level, cursor: s.cursor });
        const seen = new Set(s.items.map((i) => i.id));
        s.items.push(...r.items.filter((i) => !seen.has(i.id)));
        s.cursor = r.cursor;
        s.done = !r.cursor;
      } catch (e) {
        s.error = isOffline() ? 'offline' : 'unavailable';
        console.warn(`[reading] ${id}:`, e);
      } finally {
        s.loading = false;
      }
    }),
  );
}

/** A source's error for the screen, in the current language (feeds outlive a language change). */
export function feedErrorText(id: ReadingSourceId, error: FeedError | undefined): string {
  const { name } = sourceInfo(id);
  return error === 'offline' ? t('reading.feed.offline', { name }) : t('reading.feed.unavailable', { name });
}

/** Forget a level's lists (pull to refresh / "Refresh"). */
export function resetFeed(level: LevelCode) {
  delete feeds[level];
}

/** Round-robin merge of the sources' lists so every source shows near the top. */
export function interleave(lists: ArticleSummary[][]): ArticleSummary[] {
  const out: ArticleSummary[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

// ---------- News ----------

const MINUTE = 60_000;
/** Older stories aren't listed. */
const NEWS_MAX_AGE = 24 * 60 * MINUTE;
/** Opening the view reloads a list older than this. */
const NEWS_FRESH_FOR = 10 * MINUTE;
/** "Refresh" reloads a list older than this (a failed one at once). */
const NEWS_MIN_REFRESH = 30_000;
/** Wait after a source says 429: tagesschau allows 60 requests an hour. */
const NEWS_BACKOFF = 10 * MINUTE;

export interface NewsFeed {
  items: ArticleSummary[];
  loading: boolean;
  error: FeedError;
  /** Epoch ms of the last attempt (0 = none yet). */
  loadedAt: number;
  /** No request before this time. */
  notBefore: number;
}

const emptyNews = (): Record<string, NewsFeed> =>
  Object.fromEntries(NEWS_SOURCE_IDS.map((id) => [id, { items: [], loading: false, error: '', loadedAt: 0, notBefore: 0 }]));

export const news = $state<Record<string, NewsFeed>>(emptyNews());

/** Note a failed request (a 429 stops the source's requests for a while). */
function newsFailed(id: ReadingSourceId, e: unknown): FeedError {
  if (e instanceof SourceError && e.status === 429) news[id].notBefore = Date.now() + NEWS_BACKOFF;
  console.warn(`[reading] ${id}:`, e);
  return isOffline() ? 'offline' : 'unavailable';
}

/**
 * Update the news lists: on opening the view when they're old, with `force` on "Refresh". A list
 * stays until its replacement arrives, so a failed update keeps what's showing.
 */
export async function loadNews(force = false): Promise<void> {
  await Promise.allSettled(
    NEWS_SOURCE_IDS.map(async (id) => {
      const f = news[id];
      const now = Date.now();
      const wait = !force ? NEWS_FRESH_FOR : f.error ? 0 : NEWS_MIN_REFRESH;
      if (f.loading || now < f.notBefore || (f.loadedAt && now - f.loadedAt < wait)) return;
      f.loading = true;
      f.error = '';
      try {
        f.items = (await listArticles(id)).items;
      } catch (e) {
        f.error = newsFailed(id, e);
      } finally {
        f.loadedAt = now;
        f.loading = false;
      }
    }),
  );
}

/** A search of the news sources; an empty query is the normal list. */
export const newsSearch = $state({
  query: '',
  items: [] as ArticleSummary[],
  loading: false,
  errors: [] as { id: ReadingSourceId; error: FeedError }[],
});
let searchRun = 0;

/** Search every source (runs on submit, not per keystroke: each search is one tagesschau request). */
export async function searchNews(query: string): Promise<void> {
  const q = query.trim();
  const run = ++searchRun;
  Object.assign(newsSearch, { query: q, items: [], errors: [], loading: !!q });
  if (!q) return;
  const lists: ArticleSummary[][] = [];
  const errors: typeof newsSearch.errors = [];
  await Promise.allSettled(
    NEWS_SOURCE_IDS.map(async (id) => {
      try {
        if (Date.now() < news[id].notBefore) throw new SourceError('Waiting after a 429');
        lists.push((await listArticles(id, { query: q })).items);
      } catch (e) {
        errors.push({ id, error: newsFailed(id, e) });
      }
    }),
  );
  if (run !== searchRun) return;
  Object.assign(newsSearch, { items: byDate(lists), errors, loading: false });
}

/** For tests: back to no lists. */
export function resetNews() {
  Object.assign(news, emptyNews());
  searchRun++;
  Object.assign(newsSearch, { query: '', items: [], errors: [], loading: false });
}

/** Newest first. */
function byDate(lists: ArticleSummary[][]): ArticleSummary[] {
  return lists.flat().sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
}

/** The sources' stories of the last 24 hours, newest first. */
export function mergeNews(lists: ArticleSummary[][], now = Date.now()): ArticleSummary[] {
  return byDate(lists).filter((a) => a.publishedAt !== undefined && now - a.publishedAt < NEWS_MAX_AGE);
}

/** The stories of one source and topic ('' = all). */
export function filterNews(items: ArticleSummary[], source: ReadingSourceId | '', topic: NewsTopic | ''): ArticleSummary[] {
  return items.filter((a) => (!source || a.source === source) && (!topic || a.topic === topic));
}

/** "1. Nov., 15:51"; with the year when it isn't this year's. */
export function newsDate(ms: number, now = Date.now()): string {
  const thisYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale(), {
    day: 'numeric',
    month: 'short',
    year: thisYear ? undefined : 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ms);
}
