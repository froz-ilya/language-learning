import type { Auxiliary, Gender, Pos } from '../types';

/**
 * Level presets: A1–B1 are the Goethe-Zertifikat word lists; B2–C2, which have no official list,
 * are estimates. Data is generated at build time into public/levels/ (see scripts/levels/).
 */
export type LevelCode = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export const LEVELS: LevelCode[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export const LEVEL_TITLES: Record<LevelCode, string> = {
  A1: 'Beginner',
  A2: 'Elementary',
  B1: 'Intermediate',
  B2: 'Upper intermediate',
  C1: 'Advanced',
  C2: 'Proficient',
};

/** One word in public/levels/<code>.json */
export interface LevelWord {
  /**
   * Unique across all levels and never changed, as progress is tied to it: "A1:Waffe" is a B2 word
   * by now. The level is the file a word is in, not this prefix.
   */
  id: string;
  term: string;
  pos: Pos;
  genders: Gender[];
  plural: string;
  praeteritum: string;
  partizip2: string;
  auxiliary: Auxiliary;
  /** Translations, each a comma-separated string of up to 3 meanings. */
  tr: { ru: string; en: string };
  example?: { de: string; ru?: string; en?: string };
  /** Topic set name within the level, e.g. "Essen & Trinken" or "Essen & Trinken 2". */
  topic: string;
  /** Frequency rank (1 = most common). */
  rank: number;
}

/** public/levels/<code>.json */
export interface LevelFile {
  level: LevelCode;
  /** The index version this file belongs to; absent on files from before version 2. */
  version?: number;
  words: LevelWord[];
}

/** public/levels/index.json */
export interface LevelIndex {
  /** Goes up when words change level: installed levels then sync (syncLevels). */
  version: number;
  /** Attribution line for Settings → About. */
  sources: string;
  levels: {
    code: LevelCode;
    words: number;
    topics: { name: string; count: number }[];
  }[];
}
