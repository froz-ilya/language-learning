import type { LevelCode } from '../../levels/types';
import type { Article, ArticleSummary, ReadingSourceInfo } from '../types';
import type { ListOptions, ListResult, Source } from './types';
import { SourceError } from './mediawiki';

/** One bundled text (public/reading/gutenberg.json, built by scripts/reading/gutenberg.mjs). */
export interface GutenbergText {
  /** e.g. "grimm-rotkaeppchen", or "kafka-verwandlung-i-2" for part 2 of a long text. */
  id: string;
  title: string;
  author: string;
  /** The book the text comes from. */
  work: string;
  /** Project Gutenberg ebook page. */
  url: string;
  level: LevelCode;
  words: number;
  snippet: string;
  paragraphs: string[];
}

export interface GutenbergFile {
  version: number;
  license: string;
  texts: GutenbergText[];
}

export const GUTENBERG_LICENSE = 'Public domain (Project Gutenberg)';
const PAGE = 20;

/** Part number of a multi-part text ("…-2" with a "(2/5)" title), else 0. */
function partOf(t: GutenbergText): number {
  const m = /\((\d+)\/\d+\)$/.exec(t.title);
  return m ? Number(m[1]) : 0;
}

/** Texts are listed by their first part only; later parts are reached with "Next part". */
const isListed = (t: GutenbergText) => partOf(t) <= 1 && !/–\s*Teil\s+(?!I\b)[IVX]+/.test(t.title);

let cache: Promise<GutenbergFile> | undefined;

/** The bundled file (fetched once per session; the service worker caches it for offline use). */
export function loadGutenberg(fetchImpl: typeof fetch = fetch): Promise<GutenbergFile> {
  cache ??= (async () => {
    const res = await fetchImpl(`${import.meta.env.BASE_URL}reading/gutenberg.json`);
    if (!res.ok) throw new SourceError(`HTTP ${res.status}`, res.status);
    const data = (await res.json()) as GutenbergFile;
    if (!Array.isArray(data?.texts)) throw new SourceError('Invalid gutenberg.json');
    return data;
  })();
  cache.catch(() => (cache = undefined));
  return cache;
}

/** For tests: forget the loaded file. */
export function resetGutenbergCache() {
  cache = undefined;
}

function toArticle(t: GutenbergText): Article {
  return {
    id: `gutenberg:${t.id}`,
    source: 'gutenberg',
    title: t.title,
    paragraphs: t.paragraphs,
    url: t.url,
    license: GUTENBERG_LICENSE,
    attribution: `${t.author}, ${t.work} · ${GUTENBERG_LICENSE}`,
  };
}

/** The text after `id` when it continues the same work (next part / next chapter), else null. */
export async function nextPart(id: string): Promise<{ id: string; title: string } | null> {
  const key = id.replace(/^gutenberg:/, '');
  const { texts } = await loadGutenberg();
  const i = texts.findIndex((t) => t.id === key);
  const next = texts[i + 1];
  if (i < 0 || !next) return null;
  const series = (s: string) => s.replace(/-\d+$/, '').replace(/-(?:i|ii|iii|iv|v)$/, '');
  return series(next.id) === series(key) ? { id: `gutenberg:${next.id}`, title: next.title } : null;
}

export function gutenbergSource(info: ReadingSourceInfo): Source {
  async function list(opts: ListOptions = {}): Promise<ListResult> {
    const { texts } = await loadGutenberg();
    const q = opts.query?.trim().toLowerCase();
    const matches = texts.filter((t) =>
      q ? `${t.title} ${t.author} ${t.work}`.toLowerCase().includes(q) : isListed(t) && (!opts.level || t.level === opts.level),
    );
    const offset = Number(opts.cursor) || 0;
    const items: ArticleSummary[] = matches.slice(offset, offset + PAGE).map((t) => ({
      id: `gutenberg:${t.id}`,
      source: 'gutenberg',
      title: t.title.replace(/\s*\(1\/\d+\)$/, ''),
      snippet: `${t.author} · ${t.snippet}`,
      level: t.level,
    }));
    const next = offset + PAGE;
    return { items, cursor: next < matches.length ? String(next) : undefined };
  }

  async function get(key: string): Promise<Article> {
    const { texts } = await loadGutenberg();
    const t = texts.find((x) => x.id === key);
    if (!t) throw new SourceError(`No bundled text “${key}”`, 404);
    return toArticle(t);
  }

  return { info, list, get };
}
