import type { Card as FsrsCard } from 'ts-fsrs';

export type Lang = 'ru' | 'en';
export type Pos = 'noun' | 'verb' | 'adj' | 'other';
export type Gender = 'm' | 'f' | 'n';
export type Auxiliary = '' | 'haben' | 'sein';

export interface Example {
  de: string;
  tr?: string;
}

export interface Folder {
  id?: number;
  name: string;
  /** '' for user folders; 'A1'…'C2' for an installed level preset. */
  level: string;
  createdAt: number;
}

/** folderId 0 means "not in a folder" (IndexedDB cannot index null). */
export interface WordSet {
  id?: number;
  name: string;
  folderId: number;
  /** '' for user sets; level code for preset topic sets. */
  level: string;
  /** Topic name for preset sets (e.g. "Essen & Trinken"), '' otherwise. */
  topic: string;
  createdAt: number;
}

export interface Card {
  id?: number;
  setId: number;
  /** German lemma without article, e.g. "Haus", "gehen". */
  term: string;
  translation: string;
  pos: Pos;
  genders: Gender[];
  plural: string;
  praeteritum: string;
  partizip2: string;
  auxiliary: Auxiliary;
  examples: Example[];
  notes: string;
  /** 1/0 instead of boolean so it can be indexed. */
  starred: number;
  /** Saved without dictionary auto-fill (e.g. offline); filled later. */
  needsFill: number;
  /** 1 = marked "known" manually: skipped in sessions, counts as done in progress. */
  known: number;
  /** Level preset word id like "A1:Haus"; '' for user words. */
  presetId: string;
  createdAt: number;
}

export interface Review {
  cardId: number;
  /** Epoch ms, duplicated from fsrs.due for indexing. */
  due: number;
  fsrs: FsrsCard;
  mistakes: number;
  lastWrong: number;
}

export type Direction = 'de-x' | 'x-de' | 'mixed';
export type Strictness = 'lenient' | 'strict';

export interface Settings {
  id: 'main';
  lang: Lang;
  voiceURI: string;
  rate: number;
  autoplay: boolean;
  strictness: Strictness;
  requireArticle: boolean;
  direction: Direction;
  /** New (never studied) words added to a smart session. */
  newPerSession: number;
  /** Source of new words for the Today session, e.g. "set/3", "level/A1"; '' = own sets. */
  focus: string;
  /** Backup reminder interval in days (0 = off). Shown as a pop-up when the app opens. */
  backupEvery: number;
  /** Epoch ms of the last successful backup export (0 = never). */
  lastBackupAt: number;
  /** Epoch ms until which the reminder is snoozed ("Later"). */
  backupSnoozeUntil: number;
}

/** What a dictionary lookup can fill into a card. */
export interface LookupResult {
  term: string;
  pos: Pos;
  genders: Gender[];
  plural: string;
  praeteritum: string;
  partizip2: string;
  auxiliary: Auxiliary;
  translation: string;
  examples: Example[];
  source: 'local' | 'wiktionary' | 'compound' | 'google';
  /** Set when the typed word was an inflected form, e.g. "ging" → "gehen". */
  lemmaOf?: string;
}
