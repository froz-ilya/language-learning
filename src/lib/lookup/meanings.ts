/**
 * Choosing and capping translation meanings for lookups. The string format is the one of
 * src/lib/german/meanings.ts: meanings separated by "; ", synonyms within a meaning by ", "
 * (Folge → "последствие; череда, ряд; эпизод"). The offline build (scripts/levels/lib/extract.mjs)
 * uses the same rules.
 */
import type { Lang } from '../types';
import { joinMeanings, splitMeanings } from '../german/meanings';

export const MAX_MEANINGS = 3;
/** Synonyms per meaning when there are several meanings. */
export const MAX_SYNONYMS = 2;
/** Synonyms of a word with a single meaning ("мобильный телефон, сотовый телефон, сотовый"). */
export const MAX_SINGLE = 3;

const tokens = (w: string) => w.toLowerCase().split(/[\s\-–/]+/).filter(Boolean).join(' ');

/** Near-duplicate: the same word, or one is a whole-word part of the other ("current" / "electric current"). */
export function similarWord(a: string, b: string): boolean {
  const x = tokens(a);
  const y = tokens(b);
  return x === y || ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `);
}

/**
 * Meanings in the given order with words already used by an earlier meaning dropped and empty
 * meanings skipped; at most MAX_MEANINGS of at most MAX_SYNONYMS words (a single meaning keeps
 * MAX_SINGLE). Words never contain the separators "," or ";".
 */
export function limitMeanings(meanings: string[][]): string[][] {
  const out: string[][] = [];
  const used: string[] = [];
  for (const m of meanings) {
    if (out.length >= MAX_MEANINGS) break;
    const words: string[] = [];
    for (const raw of m) {
      const w = raw.replace(/[;,]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!w || used.some((u) => similarWord(u, w)) || words.some((u) => similarWord(u, w))) continue;
      words.push(w);
    }
    if (!words.length) continue;
    out.push(words.slice(0, MAX_SINGLE));
    used.push(...words.slice(0, out.length === 1 ? MAX_SINGLE : MAX_SYNONYMS));
  }
  return out.length > 1 ? out.map((m) => m.slice(0, MAX_SYNONYMS)) : out;
}

/** Meanings → translation string: [["house"], ["home"]] → "house; home". */
export function formatMeanings(meanings: string[][]): string {
  return joinMeanings(limitMeanings(meanings));
}

/**
 * Do two dictionary blocks mean the same thing? True when, in some language both translate,
 * their first meanings share a word (der/das Teil: часть). Undecidable (one block has no
 * translations) counts as the same, so such blocks are merged as before. Same rule as
 * sameMeaning in scripts/levels/lib/extract.mjs.
 */
export function sameMeaning(a: Record<'ru' | 'en', string[][]>, b: Record<'ru' | 'en', string[][]>): boolean {
  const has = (t: Record<'ru' | 'en', string[][]>) => t.ru.length > 0 || t.en.length > 0;
  if (!has(a) || !has(b)) return true;
  let compared = false;
  for (const lang of ['ru', 'en'] as const) {
    const x = a[lang][0] ?? [];
    const y = b[lang][0] ?? [];
    if (!x.length || !y.length) continue;
    compared = true;
    if (x.some((u) => y.some((v) => similarWord(u, v)))) return true;
  }
  return !compared;
}

/** Meanings of two sources of one word (homonym blocks of one article): first meaning of each, then the rest. */
export function mergeMeanings(a: string[][], b: string[][]): string[][] {
  if (!a.length || !b.length) return a.length ? a : b;
  return limitMeanings([a[0], b[0], ...a.slice(1), ...b.slice(1)]);
}

/** Most prepositions a card gets (Card.preps). */
export const MAX_PREPS = 3;

/** Prepositions ("auf + Akk") as Card.preps: "auf + Akk; über + Akk", each once, at most MAX_PREPS. */
export const formatPreps = (preps: string[]): string => [...new Set(preps)].slice(0, MAX_PREPS).join('; ');

/** Short preview of a translation string: two synonyms, or the first word of the first two meanings. */
export function previewOf(translation: string | undefined): string {
  const m = splitMeanings(translation ?? '');
  if (m.length > 1) return joinMeanings(m.slice(0, 2).map((x) => x.slice(0, 1)));
  return (m[0] ?? []).slice(0, 2).join(', ');
}

/** One sense's translations into a language, as parsed from a translation table. */
export interface SenseTranslations {
  /** Sense number ([1], [2], …; subsenses count as their sense); 99 when the table names none. */
  n: number;
  /** Words in table order; `labelled` for regional/register-labelled ones ("''besonders Schottland:''"). */
  words: { word: string; labelled: boolean }[];
  /** How many languages the table translates this sense into (how much the sense matters). */
  weight: number;
}

/**
 * Meanings of a word from its per-sense translations, best first — the same rules as the
 * offline build: the first plain sense, then other plain senses translated into at least
 * `minShare` as many languages (sense 2 always when sense 1 gave a single word), the heaviest
 * first, at most MAX_MEANINGS, shown in sense order. Unlabelled words come first; in the first
 * meaning, words that recur in other senses lead. `marginal` senses (colloquial, archaic,
 * regional, …) are used only when nothing else is translated.
 */
export function pickMeanings(senses: SenseTranslations[], marginal: Set<number> = new Set(), minShare = 0.3): string[][] {
  const usable = senses.filter((s) => s.words.length);
  if (!usable.length) return [];
  const sorted = [...usable].sort((a, b) => Number(marginal.has(a.n)) - Number(marginal.has(b.n)) || a.n - b.n);
  const first = sorted[0];
  // The first meaning starts with words that recur in other plain senses ("go" for gehen).
  const recur = new Map<string, number>();
  for (const s of usable) {
    if (marginal.has(s.n)) continue;
    for (const w of new Set(s.words.map((x) => x.word.toLowerCase()))) recur.set(w, (recur.get(w) ?? 0) + 1);
  }
  const words = (s: SenseTranslations) => {
    const good = s.words.filter((w) => !w.labelled);
    const list = (good.length ? good : s.words).map((w) => w.word);
    if (s === first) list.sort((a, b) => (recur.get(b.toLowerCase()) ?? 0) - (recur.get(a.toLowerCase()) ?? 0));
    return [...new Set(list)];
  };
  const thin = first.n === 1 && words(first).length < 2;
  const others = sorted
    .filter((s) => s !== first && !marginal.has(s.n) && s.words.some((w) => !w.labelled))
    .filter((s) => s.weight >= minShare * first.weight || (thin && s.n === 2))
    .sort((a, b) => b.weight - a.weight || a.n - b.n);
  const picked = [first];
  let meanings = limitMeanings([words(first)]);
  for (const s of others) {
    if (picked.length >= MAX_MEANINGS) break;
    const next = [...picked, s].sort((a, b) => a.n - b.n);
    const m = limitMeanings(next.map(words));
    if (m.length > meanings.length) {
      picked.push(s);
      meanings = m;
    }
  }
  return meanings;
}

/** What sense matching needs of a page's numbered sense (WikiSense in ./wiktionary). */
export interface SenseLike {
  translations: Record<Lang, string[]>;
  examples: string[];
  reflexive?: true;
  preps?: string[];
}

/**
 * The page senses each meaning of a translation stands for, best first: the senses whose
 * translations into `lang` share a word with the meaning (similarWord; most shared words first,
 * then page order). A meaning no sense shares a word with is tried through `other`, the word's
 * translation into the other language, but only when that has as many meanings (so its meaning i
 * is this one). When nothing matched at all, a page with a single sense is the first meaning's
 * sense; otherwise an unmatched meaning gets [] — no example beats one of another meaning.
 * Entry i belongs to splitMeanings(translation)[i].
 */
export function matchSenses<S extends SenseLike>(translation: string, senses: S[], lang: Lang, other = ''): S[][] {
  const meanings = splitMeanings(translation);
  const alt = splitMeanings(other);
  const otherLang: Lang = lang === 'ru' ? 'en' : 'ru';
  const matching = (words: string[], l: Lang) =>
    senses
      .map((s, i) => ({ s, i, k: words.filter((w) => (s.translations[l] ?? []).some((t) => similarWord(w, t))).length }))
      .filter((x) => x.k > 0)
      .sort((a, b) => b.k - a.k || a.i - b.i)
      .map((x) => x.s);
  const out = meanings.map((m, i) => {
    const direct = matching(m, lang);
    return direct.length || alt.length !== meanings.length ? direct : matching(alt[i], otherLang);
  });
  if (senses.length === 1 && out.length && out.every((x) => !x.length)) out[0] = [senses[0]];
  return out;
}

/**
 * Example sentences per meaning from its matched senses (see matchSenses): up to `per` each and
 * `total` in all, handed out a round at a time (every meaning's first example before any second
 * one). A sentence goes to the first meaning that takes it.
 */
export function meaningSentences(matched: SenseLike[][], per: number, total: number): string[][] {
  const out = matched.map((): string[] => []);
  const used = new Set<string>();
  let left = total;
  for (let round = 0; round < per && left > 0; round++) {
    matched.forEach((senses, i) => {
      if (left <= 0 || out[i].length > round) return;
      const next = senses.flatMap((s) => s.examples).find((ex) => !used.has(ex));
      if (next === undefined) return;
      used.add(next);
      out[i].push(next);
      left--;
    });
  }
  return out;
}
