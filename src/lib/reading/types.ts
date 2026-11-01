import type { LevelCode } from '../levels/types';

/**
 * Reading sources. All are open-licensed except the news (tagesschau, dw), which are fetched on
 * the phone and never bundled (sources/news.ts). Attribution is shown under every article.
 */
export type ReadingSourceId = 'miniklexikon' | 'klexikon' | 'wikinews' | 'wikipedia' | 'gutenberg' | 'tagesschau' | 'dw' | 'paste';

/** Topics of the news view: the sources' sections mapped to one list. */
export type NewsTopic = 'germany' | 'world' | 'economy' | 'science' | 'culture' | 'sport';

export interface ReadingSourceInfo {
  id: ReadingSourceId;
  name: string;
  /** Shorter name for tight rows (the news filter). */
  short?: string;
  /** Levels the source has articles at (the Read tab lists it there), e.g. ['A1', 'A2']. */
  levels: LevelCode[];
  license: string;
  homepage: string;
}

/** An item in an article list (no text yet). */
export interface ArticleSummary {
  /** "<source>:<source-specific id>", e.g. "klexikon:Hund", "gutenberg:grimm-froschkoenig-1". */
  id: string;
  source: ReadingSourceId;
  title: string;
  /** Short teaser (first sentence), if cheap to get. */
  snippet?: string;
  /** Estimated level, if known without fetching the text. */
  level?: LevelCode;
  /** Word count, if known without fetching the text (catalog articles). */
  words?: number;
  /** Epoch ms of publication (news). */
  publishedAt?: number;
  /** News topic, if the source's section has one. */
  topic?: NewsTopic;
}

export interface Article {
  id: string;
  source: ReadingSourceId;
  title: string;
  /** Plain-text paragraphs (markup, tables, references removed). */
  paragraphs: string[];
  /** Canonical URL of the original. */
  url: string;
  /** e.g. "CC BY-SA 4.0" / "Public domain". */
  license: string;
  /** Attribution line, e.g. "Klexikon · CC BY-SA 4.0". */
  attribution: string;
  /** Epoch ms of publication (news; missing on everything else and on older rows). */
  publishedAt?: number;
}

/** Row in db.articles: an article the user saved, read, or added words from. */
export interface SavedArticle extends Article {
  /** Estimated CEFR level of the text. */
  level: LevelCode | '';
  /** Epoch ms when saved for offline (0 = not saved, only tracked). */
  savedAt: number;
  /** Epoch ms when marked as read (0 = unread). */
  readAt: number;
  /** The word set created for this article on the first "Add" (0 = none yet). */
  setId: number;
  /** Reading position: index of the last paragraph seen. */
  progress: number;
  /** Epoch ms when last opened in the reader (for "Continue reading"). */
  openedAt?: number;
}
