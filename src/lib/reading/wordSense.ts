/**
 * Which reading of a word the text means at one position: lemmaMap() has one entry per spelling,
 * but lower-case "armen" is arm (бедный), not Arm, and "sein" before a noun is the possessive.
 *
 * Rules, in rankReadings() (where none applies, lookupLocal's order stands):
 * - A lower-case word is not a noun (nouns go last); neither are "Sie" and "Es", whichever way
 *   they are written. Mid-sentence, a capitalised word is a noun or a name (nouns go first). At
 *   the start of a sentence the case says nothing. Text in all capitals is left alone.
 * - At the start of a sentence, a capitalised infinitive right before "Sie" or "wir" is the verb
 *   ("Arbeiten Sie hier?", "Spielen wir!"): that spelling is no other finite form.
 * - A determiner-shaped word directly before a noun, or an adjective + noun, is the determiner
 *   ("sein Arm", "seine alte Frau", "meinen Freund").
 * - After "zu", and at the end of a clause with a modal, an infinitive is the verb ("zu sein",
 *   "Das kann sein."), unless an adjective + noun follows "zu" ("zu reichen Leuten").
 * - Right after an article, possessive or preposition + article, a word is no finite verb: before
 *   a noun an adjective ("die reichen Leute"), capitalised a noun or adjective ("Das Essen").
 *
 * Known misses, all needing real grammar: a demonstrative "die" as subject ("Die wollen Geld"),
 * nominalised adjectives next to a noun that happens to share the form (der Alte → Alt).
 */
import { lookupLocal } from '../dict/local';
import type { LexEntry, LocalHit } from '../dict/types';
import type { Lookup } from './separable';
import type { Token } from './text';

/** Hits of a word already looked up; [] when unknown. */
export type HitsOf = (word: string) => LocalHit[];

/** mein, seinen, einige, diese, …: words that can stand before a noun. */
const DETERMINER_SHAPED = /^(?:ein|kein|mein|dein|sein|ihr|unser|eu?r|euer|dies|jed|manch|welch|einig|all|viel|wenig|beid)(?:e[nmrs]?)?$/;
/** Articles, possessives, prepositions with an article: a noun or its adjective comes next. */
const OPENS_NOUN = /^(?:de[rmns]|die|das|(?:ein|kein|mein|dein|sein|ihr|unser|eu?r|dies|jed)(?:e[nmrs]?)?|euer|am|im|ans|ins|aufs|beim|vom|zum|zur|ums|fürs|durchs)$/;
/** Capitalised pronouns, not the noun of a noun phrase ("Was meinen Sie?"). */
const COURTESY = /^(?:sie|ihnen|ihr(?:e[nmrs]?)?)$/i;
/** Subjects a finite verb spelled like its infinitive has right behind it. */
const INFINITIVE_SUBJECT = /^(?:sie|wir)$/i;
/** Pronouns with a junk noun reading: "das Sie", "das Es". */
const NOT_NOUNS = /^(?:sie|es)$/i;
/** Finite modals (and werden) that leave an infinitive at the end of the clause. */
const MODALS =
  /^(?:kann|kannst|könn\p{L}*|konnt\p{L}*|muss|musst|muß|müss\p{L}*|musst\p{L}*|mußt\p{L}*|will|willst|woll\p{L}*|soll\p{L}*|darf|darfst|dürf\p{L}*|durft\p{L}*|mag|magst|mög\p{L}*|mocht\p{L}*|möcht\p{L}*|werd\p{L}*|wirst|wird|würd\p{L}*)$/iu;
/** Punctuation that ends a clause. */
const CLAUSE_END = /[,;:.!?"„“”«»‚‘()[\]{}…–—]/;

const isLower = (w: string) => /^\p{Ll}/u.test(w);
const isUpper = (w: string) => /^\p{Lu}/u.test(w);
const isAllCaps = (w: string) => w.length > 1 && w === w.toUpperCase();

const toFront = (list: LexEntry[], test: (e: LexEntry) => boolean) => [...list.filter(test), ...list.filter((e) => !test(e))];
const toBack = (list: LexEntry[], test: (e: LexEntry) => boolean) => toFront(list, (e) => !test(e));
const isNoun = (e: LexEntry) => e.pos === 'noun';
const isVerb = (e: LexEntry) => e.pos === 'verb';

/** The word next to token `i` (`step` = 1 after it, -1 before it) with only blanks between, or undefined. */
function neighbour(tokens: Token[], i: number, step: 1 | -1): number | undefined {
  const gap = tokens[i + step];
  if (!gap || gap.word || gap.text.trim()) return undefined;
  return tokens[i + 2 * step]?.word ? i + 2 * step : undefined;
}

/** Anything but a blank or a comma before the word may start a sentence (quotes, colons, abbreviations). */
const startsSentence = (tokens: Token[], i: number) => i < 2 || !/^[\s,]*$/.test(tokens[i - 1].text);

const endsClause = (tokens: Token[], i: number) => i + 1 >= tokens.length || CLAUSE_END.test(tokens[i + 1].text);

/** Is a modal among the words before token `i`, up to the start of its clause? */
function modalBefore(tokens: Token[], i: number): boolean {
  for (let k = i - 1; k >= 0; k--) {
    const t = tokens[k];
    if (t.word ? MODALS.test(t.text) : CLAUSE_END.test(t.text)) return t.word;
  }
  return false;
}

const nounLike = (w: string) => isUpper(w) && !COURTESY.test(w);

/** A noun right after token `i`, or an adjective and then a noun. */
function nounPhraseAfter(tokens: Token[], i: number, hitsOf: HitsOf): boolean {
  const next = neighbour(tokens, i, 1);
  if (next === undefined) return false;
  const text = tokens[next].text;
  if (nounLike(text)) return true;
  const after = neighbour(tokens, next, 1);
  return isLower(text) && after !== undefined && nounLike(tokens[after].text) && hitsOf(text).some((h) => h.entry.pos === 'adj');
}

/**
 * Different readings among hits, in order: one per term and part of speech, without compounds of
 * another verb among them ("sah" → ansehen next to sehen; a split verb is a verb group's business).
 */
function distinct(hits: LocalHit[]): LexEntry[] {
  const verbs = hits.filter((h) => isVerb(h.entry)).map((h) => h.entry.term);
  const seen = new Set<string>();
  const out: LexEntry[] = [];
  for (const { entry: e, form } of hits) {
    const key = `${e.term} ${e.pos}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (form && isVerb(e) && verbs.some((v) => v !== e.term && e.term.endsWith(v))) continue;
    out.push(e);
  }
  return out;
}

/** The readings of token `i`, best first: distinct(), then the rules at the top of this file. */
export function rankReadings(tokens: Token[], i: number, hitsOf: HitsOf): LexEntry[] {
  const word = tokens[i].text;
  let list = distinct(hitsOf(word));
  if (list.length < 2 || isAllCaps(word)) return list;
  const lower = word.toLowerCase();
  const lowerCase = isLower(word);
  const start = startsSentence(tokens, i);
  /** A reading whose lemma the word starts with: "reichen" → reich, not weich. */
  const stem = (e: LexEntry) => lower.startsWith(e.term.toLowerCase());

  if (lowerCase || NOT_NOUNS.test(word)) list = toBack(list, isNoun);
  else if (!start) list = toFront(list, isNoun);

  const nounPhrase = nounPhraseAfter(tokens, i, hitsOf);
  const prevAt = neighbour(tokens, i, -1);
  const prev = prevAt === undefined ? '' : tokens[prevAt].text.toLowerCase();
  const isInfinitive = (e: LexEntry) => isVerb(e) && e.term === lower;
  const hasAdj = list.some((e) => e.pos === 'adj');

  const nextAt = neighbour(tokens, i, 1);
  if (start && !lowerCase && list.some(isInfinitive) && nextAt !== undefined && INFINITIVE_SUBJECT.test(tokens[nextAt].text)) {
    list = toFront(list, isInfinitive);
  } else if ((lowerCase || start) && DETERMINER_SHAPED.test(lower) && nounPhrase) {
    list = toFront(toFront(list, (e) => e.pos === 'other'), (e) => e.pos === 'other' && stem(e));
  } else if (lowerCase && list.some(isInfinitive) && (prev === 'zu' ? !(hasAdj && nounPhrase) : endsClause(tokens, i) && modalBefore(tokens, i))) {
    list = toFront(list, isInfinitive);
  } else if (OPENS_NOUN.test(prev)) {
    if (!lowerCase) list = toBack(list, isVerb);
    else if (nounPhrase) list = toFront(toFront(list, (e) => e.pos === 'adj'), (e) => e.pos === 'adj' && stem(e));
  }
  return list;
}

/**
 * Readings of the words of every paragraph: one map per paragraph, token index → the readings at
 * that position, best first, only for tokens with 2+ different readings. Never throws (no
 * readings when the dictionary can't be read).
 */
export async function tokenReadings(paragraphs: Token[][], lookup: Lookup = lookupLocal): Promise<Map<number, LexEntry[]>[]> {
  try {
    const words = new Set<string>();
    for (const tokens of paragraphs) for (const t of tokens) if (t.word) words.add(t.text);
    const list = [...words];
    const hits = new Map<string, LocalHit[]>();
    // Small batches: lookups load dictionary pieces lazily.
    for (let i = 0; i < list.length; i += 40) {
      const batch = list.slice(i, i + 40);
      const found = await Promise.all(batch.map((w) => lookup(w).catch(() => [])));
      batch.forEach((w, j) => hits.set(w, found[j]));
    }
    const hitsOf: HitsOf = (w) => hits.get(w) ?? [];
    return paragraphs.map((tokens) => {
      const out = new Map<number, LexEntry[]>();
      tokens.forEach((t, i) => {
        if (!t.word || hitsOf(t.text).length < 2) return;
        const readings = rankReadings(tokens, i, hitsOf);
        if (readings.length > 1) out.set(i, readings);
      });
      return out;
    });
  } catch {
    return paragraphs.map(() => new Map());
  }
}
