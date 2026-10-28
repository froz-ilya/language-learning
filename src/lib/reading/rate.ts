/**
 * Level rating of a whole text: the one pipeline used by the reader, the live article lists
 * (Wikinews, Wikipedia) and the Klexikon catalog build (scripts/reading/klexikon.mjs imports
 * this module), so all of them give the same level for the same paragraphs.
 * No IndexedDB here: the catalog build runs it in Node.
 */
import { lemmatize } from '../dict/local';
import type { LexEntry } from '../dict/types';
import type { LevelCode } from '../levels/types';
import { estimateLevel, type WordRank } from './level';
import { headingText, tokenize, type Token } from './text';

/** Lemma entries for every distinct word token (keyed by the token as written). */
export async function lemmaMap(paragraphs: Token[][]): Promise<Map<string, LexEntry | null>> {
  const words = new Set<string>();
  for (const tokens of paragraphs) for (const t of tokens) if (t.word) words.add(t.text);
  const out = new Map<string, LexEntry | null>();
  const list = [...words];
  // Small batches: lemmatize() loads dictionary pieces lazily.
  for (let i = 0; i < list.length; i += 40) {
    const batch = list.slice(i, i + 40);
    const entries = await Promise.all(batch.map((w) => lemmatize(w).catch(() => null)));
    batch.forEach((w, j) => out.set(w, entries[j]));
  }
  return out;
}

/** Tokens of each paragraph (heading markers removed), as the reader shows them. */
export const paragraphTokens = (paragraphs: string[]): Token[][] => paragraphs.map((p) => tokenize(headingText(p)));

/** The rank lookup estimateLevel() needs, from a lemma map. */
export const rankLookup =
  (lemmas: Map<string, LexEntry | null>) =>
  (word: string): WordRank | null => {
    const e = lemmas.get(word);
    return e ? { rank: e.rank, pos: e.pos, lemma: e.term } : null;
  };

/** Estimated level of paragraphs of text (null when too short or the dictionary isn't available). */
export async function rateParagraphs(paragraphs: string[], title?: string): Promise<LevelCode | null> {
  const tokens = paragraphTokens(paragraphs);
  const lemmas = await lemmaMap(tokens);
  return estimateLevel(tokens.flat(), rankLookup(lemmas), { title });
}

/**
 * Rate list items from a sample of their text (one paragraph list per item) and, with a
 * `level`, keep only the items at that level (unratable ones are dropped too). Every kept item
 * gets its `level`. For live sources whose lists can't be pre-rated (Wikinews, Wikipedia).
 */
export async function keepLevel<T extends { level?: LevelCode; title: string }>(
  rows: { item: T; paragraphs: string[] }[],
  level?: LevelCode,
): Promise<T[]> {
  const levels = await Promise.all(rows.map((r) => rateParagraphs(r.paragraphs, r.item.title).catch(() => null)));
  const out: T[] = [];
  rows.forEach(({ item }, i) => {
    const l = levels[i];
    if (level && l !== level) return;
    out.push(l ? { ...item, level: l } : item);
  });
  return out;
}
