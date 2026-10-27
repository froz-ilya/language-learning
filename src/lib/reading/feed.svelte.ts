import type { LevelCode } from '../levels/types';
import type { ArticleSummary, ReadingSourceId } from './types';
import { listArticles, sourceInfo, sourcesForLevel } from './sources';

/**
 * Article lists of the Read tab, per level, kept for the session so going back from the reader
 * doesn't refetch (one request per source per user action).
 */
export interface SourceFeed {
  items: ArticleSummary[];
  cursor?: string;
  /** A page was loaded and there's nothing more. */
  done: boolean;
  loading: boolean;
  /** Last error message (the other sources still show). */
  error: string;
}

export interface LevelFeed {
  level: LevelCode;
  sources: Partial<Record<ReadingSourceId, SourceFeed>>;
}

export const feeds = $state<Partial<Record<LevelCode, LevelFeed>>>({});
/** The level chosen on the Read tab this session (null until the user picks one). */
export const readUi = $state({ level: null as LevelCode | null });

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
        s.error = isOffline()
          ? `${sourceInfo(id).name} needs a connection`
          : `${sourceInfo(id).name} is unavailable right now`;
        console.warn(`[reading] ${id}:`, e);
      } finally {
        s.loading = false;
      }
    }),
  );
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
