import type { Auxiliary, Gender, Pos } from '../types';

/**
 * Level presets: approximate CEFR bands built from word frequency (not official Goethe lists).
 * Data is generated at build time into public/levels/ (see scripts/levels/).
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
  /** "<level>:<term>", unique across all levels, e.g. "A1:Haus". */
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
  words: LevelWord[];
}

/** public/levels/index.json */
export interface LevelIndex {
  version: number;
  /** Attribution line for Settings → About. */
  sources: string;
  levels: {
    code: LevelCode;
    words: number;
    topics: { name: string; count: number }[];
  }[];
}
