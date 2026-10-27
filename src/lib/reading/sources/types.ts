import type { LevelCode } from '../../levels/types';
import type { Article, ArticleSummary, ReadingSourceInfo } from '../types';

export interface ListOptions {
  level?: LevelCode;
  query?: string;
  /** Pagination cursor returned by the previous call. */
  cursor?: string;
  signal?: AbortSignal;
}

export interface ListResult {
  items: ArticleSummary[];
  /** Pass back to get the next page; undefined when there is no more. */
  cursor?: string;
}

/** One reading source. `key` is the id without the "<source>:" prefix. */
export interface Source {
  info: ReadingSourceInfo;
  list(opts?: ListOptions): Promise<ListResult>;
  get(key: string, signal?: AbortSignal): Promise<Article>;
}
