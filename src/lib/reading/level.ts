import type { LevelCode } from '../levels/types';
import type { WordStatus } from '../progress';
import type { Pos } from '../types';
import type { Token } from './text';

/** What the level estimate needs to know about a word (from the offline dictionary). */
export interface WordRank {
  rank: number;
  pos: Pos;
  /** Dictionary form, to count repeats of one word in different forms ("Katze", "Katzen"). */
  lemma?: string;
}

/** Upper frequency-rank bound per level (the vocabulary a learner at that level knows). */
export const LEVEL_BOUNDS: [LevelCode, number][] = [
  ['A1', 600],
  ['A2', 1300],
  ['B1', 2500],
  ['B2', 4000],
  ['C1', 6000],
];
const ORDER: LevelCode[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/** Rank assumed for a lower-case word the dictionary doesn't know (rare word). */
export const UNKNOWN_RANK = 9000;
/** Below this many content words there is too little text for an estimate. */
const MIN_CONTENT_WORDS = 12;
/** If the dictionary knows fewer than this share of words, it probably isn't loaded. */
const MIN_COVERAGE = 0.3;

/**
 * Lexical coverage the level's vocabulary must give: the rank of the word at this percentile of
 * the running words (names and topic words left out) decides the level. Calibrated on the
 * MiniKlexikon/Klexikon/Wikinews/Wikipedia texts (see scripts/reading/klexikon.mjs).
 */
const COVERAGE = 0.85;
/** A noun repeated this often (or in ≥1 % of the words of a long text) is the text's topic. */
const TOPIC_REPEATS = 3;
const TOPIC_SHARE = 0.01;

/**
 * Words up to this rank are treated as familiar for highlighting: the upper bound of the user's
 * focus level ("level/B1" → 2500), or A2's bound when there is no level focus.
 */
export function comfortRank(focus: string): number {
  const code = focus.startsWith('level/') ? focus.slice(6) : '';
  if (code === 'C2') return Infinity;
  return LEVEL_BOUNDS.find(([c]) => c === code)?.[1] ?? 1300;
}

/** Articles, pronouns, prepositions… — not worth adding or counting toward difficulty. */
export function isFunctionWord(info: WordRank | null | undefined): boolean {
  return !!info && info.pos === 'other' && info.rank < 150;
}

const isLowerCase = (w: string) => !/^\p{Lu}/u.test(w);

/** Nearest-rank percentile of a sorted array. */
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

function levelForRank(rank: number): LevelCode {
  for (const [code, max] of LEVEL_BOUNDS) if (rank <= max) return code;
  return 'C2';
}

/** Average number of words per sentence. */
export function averageSentenceLength(tokens: Token[]): number {
  let words = 0;
  let sentences = 0;
  let inSentence = false;
  for (const t of tokens) {
    if (t.word) {
      words++;
      inSentence = true;
    } else if (inSentence && /[.!?]/.test(t.text)) {
      sentences++;
      inSentence = false;
    }
  }
  if (inSentence) sentences++;
  return sentences ? words / sentences : 0;
}

/** Lower-cased words of a title that can name the topic ("Die Hauskatze" → hauskatze). */
function titleWords(title: string | undefined): string[] {
  return (title?.match(/\p{L}{3,}/gu) ?? []).map((w) => w.toLowerCase());
}

/** Is `key` (a lemma) the title word, part of it ("katze" in "hauskatze") or a compound of it? */
function inTitle(key: string, title: string[]): boolean {
  return title.some((t) => key === t || (t.length >= 4 && key.includes(t)) || (key.length >= 4 && t.includes(key)));
}

export interface EstimateOptions {
  /** The text's title: its words are topic words (explained by the text, learned in context). */
  title?: string;
}

/**
 * Estimated CEFR level of a text, from lexical coverage: the frequency rank a reader's
 * vocabulary must reach to know 85% of the running words (A1 ≤600, A2 ≤1300, B1 ≤2500,
 * B2 ≤4000, C1 ≤6000, else C2), nudged one level down for very short sentences (<8 words) and
 * up for long ones (>22; two levels above 30).
 *
 * Left out: names (capitalised words the dictionary doesn't know) and topic words — words of
 * the title and nouns the text repeats (≥3 times, or ≥1% of its words), which a text explains
 * and a reader picks up in context. Lower-case unknown words count as rare. `info(word)` gives
 * the dictionary rank (and lemma) of a word, or null if unknown. Null when the text is too
 * short or the dictionary isn't loaded.
 */
export function estimateLevel(
  tokens: Token[],
  info: (word: string) => WordRank | null | undefined,
  opts: EstimateOptions = {},
): LevelCode | null {
  const words: { key: string; rank: number; noun: boolean; fn: boolean }[] = [];
  let known = 0;
  let total = 0;
  for (const t of tokens) {
    if (!t.word) continue;
    total++;
    const i = info(t.text);
    if (i) {
      known++;
      words.push({ key: (i.lemma ?? t.text).toLowerCase(), rank: i.rank, noun: i.pos === 'noun', fn: isFunctionWord(i) });
    } else if (isLowerCase(t.text) && t.text.length > 2) {
      words.push({ key: t.text.toLowerCase(), rank: UNKNOWN_RANK, noun: true, fn: false });
    }
  }
  if (!total || known / total < MIN_COVERAGE) return null;

  const counts = new Map<string, number>();
  for (const w of words) counts.set(w.key, (counts.get(w.key) ?? 0) + 1);
  const repeats = Math.max(TOPIC_REPEATS, Math.ceil(TOPIC_SHARE * total));
  const title = titleWords(opts.title);
  const isTopic = (w: (typeof words)[number]) =>
    !w.fn && ((w.noun && counts.get(w.key)! >= repeats) || inTitle(w.key, title));
  const kept = words.filter((w) => !isTopic(w));
  if (kept.filter((w) => !w.fn).length < MIN_CONTENT_WORDS) return null;

  const ranks = kept.map((w) => w.rank).sort((a, b) => a - b);
  let idx = ORDER.indexOf(levelForRank(percentile(ranks, COVERAGE)));
  const avg = averageSentenceLength(tokens);
  if (avg > 0 && avg < 8) idx--;
  else if (avg > 30) idx += 2;
  else if (avg > 22) idx++;
  return ORDER[Math.max(0, Math.min(ORDER.length - 1, idx))];
}

/**
 * Share (0…1) of the text's word tokens the user already knows: the word's lemma is a card
 * with status learned or known. `status(word)` gives that status (undefined when no card).
 */
export function knownShare(tokens: Token[], status: (word: string) => WordStatus | undefined): number {
  let words = 0;
  let known = 0;
  for (const t of tokens) {
    if (!t.word) continue;
    words++;
    const s = status(t.text);
    if (s === 'learned' || s === 'known') known++;
  }
  return words ? known / words : 0;
}
