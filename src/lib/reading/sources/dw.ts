import type { Article, ArticleSummary, NewsTopic, ReadingSourceInfo } from '../types';
import { decodeEntities, htmlToParagraphs, stripTags } from '../text';
import { httpsUrl, newsGet } from './news';
import type { ListOptions, ListResult, Source } from './types';

const FEED = 'https://rss.dw.com/xml/rss-de-all';
const API = 'https://www.dw.com/graph-api/de/content/article/';
/** "gri/wa (dpa, rtr)": editors' initials and agencies closing an article. */
const CREDIT = /^[a-zäöü]+(?:\/[a-zäöü]+)*\s*\([^)]*\)$/;
/** The feed's categories. "Aktuelles" (top news of any kind) has no topic. */
const TOPICS: Record<string, NewsTopic> = {
  Deutschland: 'germany',
  Welt: 'world',
  Wirtschaft: 'economy',
  Wissenschaft: 'science',
  Umwelt: 'science',
  Gesundheit: 'science',
  Kultur: 'culture',
  Sport: 'sport',
};

/** A tag's text in one RSS item (plain or CDATA, entities decoded). */
function field(item: string, tag: string): string {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(item);
  return m ? decodeEntities(m[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '')).trim() : '';
}

/** The articles of the feed, in its order; videos and galleries have no "/a-<id>" link. */
export function parseFeed(xml: string): ArticleSummary[] {
  return xml
    .split(/<item[\s>]/)
    .slice(1)
    .flatMap((item) => {
      const id = /\/a-(\d+)/.exec(field(item, 'link'))?.[1];
      const title = field(item, 'title');
      const publishedAt = Date.parse(field(item, 'pubDate'));
      if (!id || !title || Number.isNaN(publishedAt)) return [];
      const snippet = stripTags(field(item, 'description'));
      const topic = TOPICS[field(item, 'category')];
      return [{ id: `dw:${id}`, source: 'dw', title, snippet: snippet || undefined, publishedAt, ...(topic ? { topic } : {}) }];
    });
}

/** DW has no open search: a query looks through the feed (its latest 80 or so articles). */
export function matchFeed(items: ArticleSummary[], query: string): ArticleSummary[] {
  const q = query.toLowerCase();
  return items.filter((a) => a.title.toLowerCase().includes(q) || a.snippet?.toLowerCase().includes(q));
}

export function dwSource(info: ReadingSourceInfo): Source {
  async function list(opts: ListOptions = {}): Promise<ListResult> {
    const res = await newsGet(FEED, info.name, opts.signal);
    const items = parseFeed(await res.text());
    const query = opts.query?.trim();
    return { items: query ? matchFeed(items, query) : items };
  }

  async function get(key: string, signal?: AbortSignal): Promise<Article> {
    const res = await newsGet(API + encodeURIComponent(key), info.name, signal);
    const body = (await res.json()) as {
      data?: { content?: { title?: string; teaser?: string; text?: string; canonicalUrl?: string; contentDate?: string } };
    };
    const a = body.data?.content;
    const teaser = a?.teaser ? stripTags(a.teaser) : '';
    const paragraphs = htmlToParagraphs(a?.text ?? '');
    if (CREDIT.test(paragraphs.at(-1) ?? '')) paragraphs.pop();
    const publishedAt = Date.parse(a?.contentDate ?? '');
    return {
      id: `dw:${key}`,
      source: 'dw',
      title: a?.title ?? '',
      // The teaser is the article's lead: the text starts after it.
      paragraphs: [...(teaser ? [teaser] : []), ...paragraphs],
      url: httpsUrl(a?.canonicalUrl, `https://www.dw.com/de/a-${encodeURIComponent(key)}`),
      license: info.license,
      attribution: `Deutsche Welle · ${info.license}`,
      ...(Number.isNaN(publishedAt) ? {} : { publishedAt }),
    };
  }

  return { info, list, get };
}
