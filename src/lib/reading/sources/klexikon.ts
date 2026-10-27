import type { Article, ArticleSummary, ReadingSourceInfo } from '../types';
import { htmlToParagraphs, stripTags } from '../text';
import type { ListOptions, ListResult, Source } from './types';
import { mwGet, parsePage, wikiUrl, type RandomResponse, type SearchResponse } from './mediawiki';

/**
 * Klexikon (children's encyclopedia, A2–B1) and MiniKlexikon (easy language, A1–A2), both
 * MediaWiki sites without TextExtracts: lists come from list=random / list=search and the text
 * from action=parse HTML.
 */
export function klexikonSource(info: ReadingSourceInfo, host: string): Source {
  const api = `https://${host}/api.php`;
  const wiki = `https://${host}/wiki/`;
  const prefix = `${info.id}:`;

  async function list(opts: ListOptions = {}): Promise<ListResult> {
    const query = opts.query?.trim();
    if (query) {
      const data = await mwGet<SearchResponse>(
        api,
        {
          action: 'query',
          list: 'search',
          srsearch: query,
          srnamespace: 0,
          srlimit: 20,
          srprop: 'snippet',
          sroffset: opts.cursor,
        },
        opts.signal,
      );
      const items: ArticleSummary[] = (data.query?.search ?? []).map((r) => ({
        id: prefix + r.title,
        source: info.id,
        title: r.title,
        snippet: r.snippet ? stripTags(r.snippet) : undefined,
      }));
      const next = data.continue?.sroffset;
      return { items, cursor: next !== undefined ? String(next) : undefined };
    }
    const data = await mwGet<RandomResponse>(
      api,
      {
        action: 'query',
        list: 'random',
        rnnamespace: 0,
        rnfilterredir: 'nonredirects',
        rnlimit: 20,
        rncontinue: opts.cursor,
      },
      opts.signal,
    );
    const items: ArticleSummary[] = (data.query?.random ?? []).map((r) => ({
      id: prefix + r.title,
      source: info.id,
      title: r.title,
    }));
    return { items, cursor: data.continue?.rncontinue };
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
