import type { LevelCode } from '../levels/types';

/** Reading sources. All are open-licensed; attribution is shown under every article. */
export type ReadingSourceId = 'miniklexikon' | 'klexikon' | 'wikinews' | 'wikipedia' | 'gutenberg' | 'paste';

export interface ReadingSourceInfo {
  id: ReadingSourceId;
  name: string;
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
