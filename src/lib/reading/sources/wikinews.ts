import type { Article, ArticleSummary, ReadingSourceInfo } from '../types';
import { extractToParagraphs, firstSentence, htmlToParagraphs, isHeading, stripTags } from '../text';
import type { ListOptions, ListResult, Source } from './types';
import { mwGet, parsePage, wikiUrl, type PagesResponse, type SearchResponse } from './mediawiki';
import { keepLevel } from '../rate';

const API = 'https://de.wikinews.org/w/api.php';
const WIKI = 'https://de.wikinews.org/wiki/';
/** Reviewed, published news articles (newest first by the time they were published). */
export const PUBLISHED_CATEGORY = 'Kategorie:Veröffentlicht';

/** "Lüneburg (Niedersachsen), 03.05.2026 – " at the start of a news text. */
const DATELINE = /^[^–—\n]{0,100}?\d{1,2}\.\d{1,2}\.\d{4}\s*[–—-]+\s*/;

/** Teaser from an intro extract: skips the repeated title, the subtitle and the dateline. */
export function newsSnippet(title: string, extract: string | undefined): string | undefined {
  if (!extract) return undefined;
  const lines = extract
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l.toLowerCase() !== title.toLowerCase());
  const body = lines.find((l) => DATELINE.test(l)) ?? lines.find((l) => /[.!?]$/.test(l)) ?? lines[0];
  if (!body) return undefined;
  const text = body.replace(DATELINE, '').replace(/^Text\s*…\s*/, '');
  return text ? firstSentence(text) : undefined;
}

/** Intro paragraphs to rate: without the repeated title and the dateline. */
export function newsText(title: string, extract: string | undefined): string[] {
  const t = title.toLowerCase();
  return extractToParagraphs(extract ?? '')
    .filter((p) => p.toLowerCase() !== t)
    .map((p) => p.replace(DATELINE, ''));
}

export function wikinewsSource(info: ReadingSourceInfo): Source {
  async function list(opts: ListOptions = {}): Promise<ListResult> {
    const query = opts.query?.trim();
    if (query) {
      const data = await mwGet<SearchResponse>(
        API,
        { action: 'query', list: 'search', srsearch: query, srnamespace: 0, srlimit: 20, srprop: 'snippet', sroffset: opts.cursor },
        opts.signal,
      );
      const items: ArticleSummary[] = (data.query?.search ?? []).map((r) => ({
        id: `wikinews:${r.title}`,
        source: 'wikinews',
        title: r.title,
        snippet: r.snippet ? stripTags(r.snippet) : undefined,
      }));
      const next = data.continue?.sroffset;
      return { items, cursor: next !== undefined ? String(next) : undefined };
    }
    // Newest published articles with their intro (one request): a teaser, and the text the
    // level is rated from. With a level, only the articles at that level are returned.
    const data = await mwGet<PagesResponse>(
      API,
      {
        action: 'query',
        generator: 'categorymembers',
        gcmtitle: PUBLISHED_CATEGORY,
        gcmnamespace: 0,
        gcmsort: 'timestamp',
        gcmdir: 'desc',
        gcmlimit: 20,
        gcmcontinue: opts.cursor,
        prop: 'extracts',
        exintro: 1,
        explaintext: 1,
        exlimit: 20,
      },
      opts.signal,
    );
    const pages = data.query?.pages ?? [];
    // Generator results lose the category order (they come by page id); newer pages have
    // higher ids, which is close enough to "newest first".
    pages.sort((a, b) => (b.pageid ?? 0) - (a.pageid ?? 0));
    const items = await keepLevel<ArticleSummary>(
      pages
        .filter((p) => !p.missing)
        .map((p) => ({
          item: { id: `wikinews:${p.title}`, source: 'wikinews', title: p.title, snippet: newsSnippet(p.title, p.extract) },
          paragraphs: newsText(p.title, p.extract),
        })),
      opts.level,
    );
    return { items, cursor: data.continue?.gcmcontinue };
  }

  async function get(key: string, signal?: AbortSignal): Promise<Article> {
    const { title, html } = await parsePage(API, key, signal);
    const t = title.toLowerCase();
    const paragraphs = htmlToParagraphs(html).filter((p) => p.toLowerCase() !== t && !(isHeading(p) && p.slice(3).toLowerCase() === t));
    return {
      id: `wikinews:${key}`,
      source: 'wikinews',
      title,
      paragraphs,
      url: wikiUrl(WIKI, title),
      license: info.license,
      attribution: `Wikinews · ${info.license}`,
    };
  }

  return { info, list, get };
}
