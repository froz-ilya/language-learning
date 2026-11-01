import type { Article, ArticleSummary, NewsTopic, ReadingSourceInfo } from '../types';
import { htmlToParagraphs, stripTags } from '../text';
import { httpsUrl, newsGet } from './news';
import type { ListOptions, ListResult, Source } from './types';

const API = 'https://www.tagesschau.de/api2u/';
const HOME = 'https://www.tagesschau.de/';

interface Story {
  type?: string;
  title?: string;
  date?: string;
  details?: string;
  shareURL?: string;
  firstSentence?: string;
  /** Set on the national editors' stories; the regional broadcasters' stories have none. */
  ressort?: string;
}

interface Block {
  type: string;
  value?: string;
  quotation?: { text?: string };
}

/** "Das Erste | tagesschau | 31.10.2026 | 20:00 Uhr": the broadcast list closing an article. */
const BROADCAST = /\|\s*\d{1,2}\.\d{1,2}\.\d{4}\s*\|/;

const TOPICS: Record<string, NewsTopic> = {
  inland: 'germany',
  ausland: 'world',
  wirtschaft: 'economy',
  wissen: 'science',
  sport: 'sport',
};

/** "…/api2u/inland/x-100.json" → "inland/x-100"; null for anything else. */
function storyKey(details: string | undefined): string | null {
  return details && details.startsWith(API) && details.endsWith('.json') ? details.slice(API.length, -'.json'.length) : null;
}

function summaries(stories: Story[] | undefined): ArticleSummary[] {
  return (stories ?? []).flatMap((n) => {
    const key = storyKey(n.details);
    const publishedAt = Date.parse(n.date ?? '');
    if (n.type !== 'story' || !key || !n.title || Number.isNaN(publishedAt)) return [];
    const topic = n.ressort ? TOPICS[n.ressort] : undefined;
    return [
      {
        id: `tagesschau:${key}`,
        source: 'tagesschau',
        title: n.title,
        snippet: n.firstSentence ? stripTags(n.firstSentence) : undefined,
        publishedAt,
        ...(topic ? { topic } : {}),
      },
    ];
  });
}

/** The national stories of a /news response, in its order (newest first). */
export const parseStories = (data: { news?: Story[] }) => summaries(data.news?.filter((n) => n.ressort));

/** The stories of a /search response, regional ones too. */
export const parseSearch = (data: { searchResults?: Story[] }) => summaries(data.searchResults);

/** An article's text blocks → paragraphs; images, videos and link boxes are left out. */
export function storyParagraphs(blocks: Block[] | undefined): string[] {
  const html = (blocks ?? []).map((b) => {
    if (b.type === 'headline') return b.value ?? '';
    if (b.type === 'quotation') return `<blockquote>${b.quotation?.text ?? ''}</blockquote>`;
    if (b.type !== 'text' || !b.value || BROADCAST.test(stripTags(b.value))) return '';
    return `<p>${b.value}</p>`;
  });
  return htmlToParagraphs(html.join(''));
}

export function tagesschauSource(info: ReadingSourceInfo): Source {
  async function list(opts: ListOptions = {}): Promise<ListResult> {
    const query = opts.query?.trim();
    if (query) {
      const q = new URLSearchParams({ searchText: query, pageSize: '30' });
      const res = await newsGet(`${API}search/?${q}`, info.name, opts.signal);
      return { items: parseSearch(await res.json()) };
    }
    const res = await newsGet(`${API}news`, info.name, opts.signal);
    return { items: parseStories(await res.json()) };
  }

  async function get(key: string, signal?: AbortSignal): Promise<Article> {
    const path = key.split('/').map(encodeURIComponent).join('/');
    const res = await newsGet(`${API}${path}.json`, info.name, signal);
    const story = (await res.json()) as Story & { content?: Block[] };
    const publishedAt = Date.parse(story.date ?? '');
    return {
      id: `tagesschau:${key}`,
      source: 'tagesschau',
      title: story.title ?? '',
      paragraphs: storyParagraphs(story.content),
      url: httpsUrl(story.shareURL, HOME),
      license: info.license,
      attribution: `tagesschau · ${info.license}`,
      ...(Number.isNaN(publishedAt) ? {} : { publishedAt }),
    };
  }

  return { info, list, get };
}
