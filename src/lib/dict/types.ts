import type { Auxiliary, Gender, Pos } from '../types';
import type { LevelCode } from '../levels/types';

/**
 * Offline dictionary (~30k most frequent German lemmas), generated at build time into
 * public/dict/ (see scripts/dict/). Loaded lazily in small pieces.
 */
export interface LexEntry {
  term: string;
  pos: Pos;
  genders: Gender[];
  plural: string;
  praeteritum: string;
  partizip2: string;
  auxiliary: Auxiliary;
  /** Comma-separated translations (≤3 meanings); '' when missing. */
  tr: { ru: string; en: string };
  /** Frequency rank, 1 = most common. */
  rank: number;
  /** Level band when the word is in the A1–C2 presets. */
  level?: LevelCode;
  /**
   * Verbs used with "sich": 'also' next to other meanings (treffen / sich treffen), 'only' when
   * the verb has no meaning without it (sich beeilen). Absent for other words.
   */
  reflexive?: 'also' | 'only';
  /** Translations of the reflexive meanings (sich treffen → встречаться), when the dictionary has them. */
  trRefl?: { ru: string; en: string };
  /** Prepositions with their case, "; "-separated, as Card.preps ("auf + Akk; über + Akk"). */
  preps?: string;
}

/** Result of a local lookup: the lemma entry plus how the input matched it. */
export interface LocalHit {
  entry: LexEntry;
  /** The input as typed when it was an inflected form ("ging" for gehen). */
  form?: string;
}
