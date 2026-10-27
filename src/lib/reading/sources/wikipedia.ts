import type { Article, ArticleSummary, ReadingSourceInfo } from '../types';
import { extractToParagraphs, firstSentence, stripTags, truncateParagraphs } from '../text';
import type { ListOptions, ListResult, Source } from './types';
import { mwGet, SourceError, wikiUrl, type PagesResponse, type SearchResponse } from './mediawiki';

const API = 'https://de.wikipedia.org/w/api.php';
const WIKI = 'https://de.wikipedia.org/wiki/';
/** Quality-reviewed articles ("exzellent" / "lesenswert"), most recently promoted first. */
export const QUALITY_CATEGORIES = ['Kategorie:Wikipedia:Exzellent', 'Kategorie:Wikipedia:Lesenswert'] as const;
/** Articles are long: the reader gets about this many words (whole paragraphs). */
export const MAX_WORDS = 1500;

/** Cursor for the quality lists: which category is next, and each one's continue token. */
interface Cursor {
  next: 0 | 1;
  /** Continue tokens per category: '' = from the start, DONE = exhausted. */
  cont: [string, string];
}
const DONE = '-';

function readCursor(s: string | undefined): Cursor {
  if (s) {
    try {
      const c = JSON.parse(s) as Cursor;
      if ((c.next === 0 || c.next === 1) && Array.isArray(c.cont) && c.cont.every((x) => typeof x === 'string')) return c;
    } catch {
      // fall through
    }
  }
  return { next: 0, cont: ['', ''] };
}

/** First sentence of an intro without parentheses (pronunciation, life dates, etymology). */
export function introSnippet(extract: string | undefined): string | undefined {
  if (!extract) return undefined;
  let t = extract.replace(/\s+/g, ' ');
  for (let i = 0; i < 3; i++) t = t.replace(/\s*\([^()]*\)/g, '');
  t = t.replace(/\s*\([^)]*$/, '…').replace(/\s+([,.;:])/g, '$1').trim();
  return t ? firstSentence(t) : undefined;
}

export function wikipediaSource(info: ReadingSourceInfo): Source {
  async function search(query: string, opts: ListOptions): Promise<ListResult> {
    const data = await mwGet<SearchResponse>(
      API,
      { action: 'query', list: 'search', srsearch: query, srnamespace: 0, srlimit: 20, srprop: 'snippet', sroffset: opts.cursor },
      opts.signal,
    );
    const items: ArticleSummary[] = (data.query?.search ?? []).map((r) => ({
      id: `wikipedia:${r.title}`,
      source: 'wikipedia',
      title: r.title,
      snippet: r.snippet ? stripTags(r.snippet) : undefined,
    }));
    const next = data.continue?.sroffset;
    return { items, cursor: next !== undefined ? String(next) : undefined };
  }

  /** One page of a quality category, alternating between "exzellent" and "lesenswert". */
  async function list(opts: ListOptions = {}): Promise<ListResult> {
    const query = opts.query?.trim();
    if (query) return search(query, opts);

    const cur = readCursor(opts.cursor);
    let which: 0 | 1 = cur.next;
    if (cur.cont[which] === DONE) which = which === 0 ? 1 : 0;
    if (cur.cont[which] === DONE) return { items: [] };

    const data = await mwGet<PagesResponse>(
      API,
      {
        action: 'query',
        generator: 'categorymembers',
        gcmtitle: QUALITY_CATEGORIES[which],
        gcmnamespace: 0,
        gcmsort: 'timestamp',
        gcmdir: 'desc',
        gcmlimit: 20,
        gcmcontinue: cur.cont[which] || undefined,
        prop: 'extracts',
        exintro: 1,
        explaintext: 1,
        exsentences: 3,
        exlimit: 20,
      },
      opts.signal,
    );
    const pages = (data.query?.pages ?? []).filter((p) => !p.missing);
    const items: ArticleSummary[] = pages.map((p) => ({
      id: `wikipedia:${p.title}`,
      source: 'wikipedia',
      title: p.title,
      snippet: introSnippet(p.extract),
    }));
    const cont: Cursor['cont'] = [...cur.cont];
    cont[which] = data.continue?.gcmcontinue ?? DONE;
    const done = cont[0] === DONE && cont[1] === DONE;
    return { items, cursor: done ? undefined : JSON.stringify({ next: which === 0 ? 1 : 0, cont } satisfies Cursor) };
  }

  async function get(key: string, signal?: AbortSignal): Promise<Article> {
    const data = await mwGet<PagesResponse>(
      API,
      {
        action: 'query',
        prop: 'extracts',
        explaintext: 1,
        exsectionformat: 'wiki',
        titles: key,
        redirects: 1,
      },
      signal,
    );
    const page = data.query?.pages?.[0];
    if (!page || page.missing || !page.extract) throw new SourceError(`Wikipedia has no article “${key}”`, 404);
    return {
      id: `wikipedia:${key}`,
      source: 'wikipedia',
      title: page.title,
      paragraphs: truncateParagraphs(extractToParagraphs(page.extract), MAX_WORDS),
      url: wikiUrl(WIKI, page.title),
      license: info.license,
      attribution: `Wikipedia · ${info.license}`,
    };
  }

  return { info, list, get };
}
