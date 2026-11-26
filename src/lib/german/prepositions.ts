/**
 * Words that go with a preposition ("denken an + Akk", "die Angst vor + Dat") and verbs that
 * take "zu" + infinitive ("pflegen zu"). Usually the preposition is a detail of the word, like
 * its plural: the card is "denken" with `preps` "an + Akk". When it changes the meaning
 * (bestehen aus / bestehen auf: `joins` in PREP_PAIRS, or the dictionary's meanings say so) the
 * word is learned with it the way a reflexive verb is learned with "sich": the preposition is the
 * last word of `term` ("bestehen auf") and `preps` holds it with its case ("auf + Dat"). Only
 * that pair makes it part of the word: a term like "ab und zu" or "bis zu" has no matching
 * `preps` entry, so it stays a plain phrase (old cards keep what they meant).
 *
 * Pure: the data scripts load lookup/wiktionary.ts, which imports these tables (no i18n here).
 */
import type { Card, Lang, Pos } from '../types';
import { baseOfReflexive, isReflexiveTerm } from './reflexive';

export type Case = 'Akk' | 'Dat' | 'Gen';
/** A preposition's case; 'Inf' for "zu" + infinitive ("pflegen zu"). */
export type PrepCase = Case | 'Inf';

/**
 * Case of a preposition's object when the wording doesn't say ("auf etwas" → Akk). Two-way
 * prepositions get the case they nearly always have after a verb (warten auf + Akk, sich
 * fürchten vor + Dat); null where both are common (an, in): those need "jemanden"/"jemandem"
 * or an explicit case. Used when reading Wiktionary's labels.
 */
export const PREP_CASE: Record<string, Case | null> = {
  mit: 'Dat', von: 'Dat', zu: 'Dat', aus: 'Dat', bei: 'Dat', nach: 'Dat', seit: 'Dat', gegenüber: 'Dat',
  für: 'Akk', um: 'Akk', gegen: 'Akk', durch: 'Akk', ohne: 'Akk',
  wegen: 'Gen',
  auf: 'Akk', über: 'Akk', vor: 'Dat', unter: 'Dat',
  an: null, in: null, neben: null, hinter: null, zwischen: null,
};

/** Prepositions whose case never depends on the wording. */
export const FIXED_CASE: ReadonlySet<string> = new Set(['mit', 'von', 'zu', 'aus', 'bei', 'nach', 'seit', 'gegenüber', 'für', 'um', 'gegen', 'durch', 'ohne', 'wegen']);

/** Two-way prepositions: Akk or Dat depends on the word they go with. */
export const TWO_WAY: ReadonlySet<string> = new Set(['an', 'auf', 'in', 'über', 'unter', 'vor', 'hinter', 'neben', 'zwischen']);

export const PREPOSITIONS: readonly string[] = Object.keys(PREP_CASE);

/** Preposition + article in one word, as sentences have them ("aufs Wochenende"). */
export const CONTRACTIONS: Record<string, string> = {
  am: 'an', ans: 'an', aufs: 'auf', im: 'in', ins: 'in', vom: 'von', zum: 'zu', zur: 'zu', beim: 'bei',
  übers: 'über', fürs: 'für', ums: 'um', durchs: 'durch', unterm: 'unter', unters: 'unter', vorm: 'vor',
  vors: 'vor', hinterm: 'hinter', hinters: 'hinter',
};

/**
 * The case each German preposition takes when it is the word being learned ("während" → Gen),
 * shown after the word like a verb's preposition ("während + Gen", see Term.svelte). Prepositions
 * are a closed class, so this lists all of them in use. Where standard German allows two cases
 * both are given (dank: Gen / Dat); colloquial Dat after wegen, trotz, statt is left out.
 */
const GOVERNS: Record<string, string> = {};
const govern = (c: string, words: string) => {
  for (const w of words.split(' ')) GOVERNS[w] = c;
};
govern('Akk', 'bis durch für gegen ohne um wider per pro');
govern('Dat', 'ab aus außer bei gegenüber mit nach seit von zu entgegen gemäß samt nebst mitsamt zuliebe zufolge entsprechend nahe');
govern(
  'Gen',
  'während wegen trotz statt anstatt anstelle innerhalb außerhalb oberhalb unterhalb aufgrund anhand mithilfe infolge ' +
    'bezüglich angesichts anlässlich abseits ausschließlich einschließlich inklusive exklusive diesseits jenseits ' +
    'beiderseits hinsichtlich inmitten kraft mangels mittels seitens aufseiten vonseiten ungeachtet unweit zugunsten ' +
    'zuungunsten zulasten zwecks namens',
);
govern('Gen / Dat', 'dank laut längs');
govern('Dat / Gen', 'binnen');
govern('Akk / Gen', 'entlang');
govern('Akk / Dat', 'an auf hinter in neben über unter vor zwischen');
// Preposition + article: dem / der → Dat ("zum", "zur"), das → Akk ("ins").
for (const w of Object.keys(CONTRACTIONS)) GOVERNS[w] = w.endsWith('s') ? 'Akk' : 'Dat';

/**
 * "während" → "Gen", "auf" → "Akk / Dat", "zum" → "Dat"; undefined for any other word. Only for
 * words that are prepositions here (pos "other"): "laut" the adjective (loud) gets nothing.
 */
export function prepCaseOf(card: Pick<Card, 'term' | 'pos'>): string | undefined {
  if (card.pos !== 'other') return undefined;
  const w = card.term.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(GOVERNS, w) ? GOVERNS[w] : undefined;
}

/** A preposition and (when known) its case. */
export interface PrepPart {
  word: string;
  case?: PrepCase;
}

const isPrep = (w: string) => Object.prototype.hasOwnProperty.call(PREP_CASE, w);

/** "auf + Akk", "zu + Inf"; just "an" while the case isn't known. */
export const formatPrep = (p: PrepPart): string => (p.case ? `${p.word} + ${p.case}` : p.word);

const CASE_OF: Record<string, PrepCase> = {
  akk: 'Akk', akkusativ: 'Akk', a: 'Akk',
  dat: 'Dat', dativ: 'Dat', d: 'Dat',
  gen: 'Gen', genitiv: 'Gen', g: 'Gen',
  inf: 'Inf', infinitiv: 'Inf',
};

/** "akk", "Dativ", "A" → the case; undefined for anything else. */
export const caseOfWord = (w: string): PrepCase | undefined => CASE_OF[w.toLowerCase().replace(/\.$/, '')];

/** One entry of Card.preps ("auf + Akk", "auf+Akk.", "an") read back; null when it isn't one. */
export function parsePrepEntry(s: string): PrepPart | null {
  const m = s.trim().match(/^(\p{L}+)(?:\s*\+\s*(\p{L}+)\.?)?$/u);
  if (!m) return null;
  const word = m[1].toLowerCase();
  if (!isPrep(word)) return null;
  const c = m[2] ? caseOfWord(m[2]) : undefined;
  if (m[2] && !c) return null;
  return c ? { word, case: c } : { word };
}

/** The entries of Card.preps that are prepositions. */
export const prepEntries = (preps?: string): PrepPart[] =>
  (preps ?? '')
    .split(';')
    .map(parsePrepEntry)
    .filter((p): p is PrepPart => !!p);

/** "warten", "auf" → "warten auf". */
export const withPrep = (base: string, word: string): string => `${base.trim()} ${word}`;

/** "warten auf" → { base: "warten", word: "auf" }: the term's last word is a preposition (syntax only). */
export function splitPrepTerm(term: string): { base: string; word: string } | null {
  const words = term.trim().split(/\s+/);
  if (words.length < 2) return null;
  const word = words[words.length - 1].toLowerCase();
  if (!isPrep(word)) return null;
  return { base: words.slice(0, -1).join(' '), word };
}

/** The preposition a card is learned with: the term's last word, when `preps` lists it. */
export function prepOfCard(c: Pick<Card, 'term'> & { preps?: string }): PrepPart | null {
  const s = splitPrepTerm(c.term);
  if (!s) return null;
  return prepEntries(c.preps).find((p) => p.word === s.word) ?? null;
}

/** The term without its preposition ("warten auf" → "warten"); other terms as they are. */
export const baseTerm = (c: Pick<Card, 'term'> & { preps?: string }): string =>
  prepOfCard(c) ? splitPrepTerm(c.term)!.base : c.term.trim();

/**
 * Replace the entry for this preposition (or add it in front), keep the others; at most 3
 * (MAX_PREPS in lookup/meanings).
 */
export function mergePrepEntry(preps: string | undefined, p: PrepPart): string {
  const rest = (preps ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && parsePrepEntry(s)?.word !== p.word);
  return [formatPrep(p), ...rest].slice(0, 3).join('; ');
}

// ---------- Common words and their preposition ----------

/** What a joining pair means (written for this app), in each language words are translated into. */
export type PairMeaning = Record<Lang, string>;

/**
 * A word that goes with a preposition. Most pairs are a detail of the word, like its plural
 * (denken, "an + Akk"). `joins`: the preposition is part of the word, learned with it like
 * "sich" — it changes the meaning (bestehen aus ≠ bestehen auf) or the word is hardly used
 * without it; `joins` holds that meaning.
 */
export interface PrepPair {
  base: string;
  word: string;
  case: PrepCase;
  pos: Pos;
  joins?: PairMeaning;
}

/** "warten auf + Akk" → a pair; a fixed-case preposition needs no case ("bestehen aus"). */
function pair(pos: Pos, text: string, joins?: PairMeaning): PrepPair {
  const m = text.match(/^(.+?)\s+(\p{L}+)(?:\s*\+\s*(Akk|Dat|Gen|Inf))?$/u);
  if (!m) throw new Error(`bad pair ${text}`);
  const word = m[2];
  const c = (m[3] as PrepCase | undefined) ?? PREP_CASE[word] ?? undefined;
  if (!c) throw new Error(`no case for ${text}`);
  return { base: m[1], word, case: c, pos, ...(joins ? { joins } : {}) };
}

const v = (text: string) => pair('verb', text);
/** A verb whose preposition is part of it, with what the pair means. */
const join = (text: string, ru: string, en: string) => pair('verb', text, { ru, en });
const adj = (text: string) => pair('adj', text);
const noun = (text: string) => pair('noun', text);

/**
 * Common words with their preposition and its case, written for this app (grammar facts, no
 * source's wording). For two-way prepositions this list wins over a dictionary's guess.
 */
export const PREP_PAIRS: readonly PrepPair[] = [
  // Joined: the preposition changes what the word means.
  join('bestehen aus', 'состоять из', 'consist of'),
  join('bestehen auf + Dat', 'настаивать на', 'insist on'),
  join('ankommen auf + Akk', 'зависеть от', 'depend on'),
  join('abhängen von', 'зависеть от', 'depend on'),
  join('sich verlassen auf + Akk', 'полагаться на', 'rely on'),
  join('verzichten auf + Akk', 'отказываться от', 'do without'),
  join('teilnehmen an + Dat', 'участвовать в', 'take part in'),
  join('sich gewöhnen an + Akk', 'привыкать к', 'get used to'),
  join('sich wenden an + Akk', 'обращаться к', 'turn to'),
  join('achten auf + Akk', 'обращать внимание на', 'pay attention to'),
  join('aufpassen auf + Akk', 'присматривать за', 'look after'),
  join('leiden an + Dat', 'страдать (болезнью)', 'suffer from (an illness)'),
  join('leiden unter + Dat', 'страдать от', 'suffer from'),
  join('verstehen unter + Dat', 'понимать под', 'mean by'),
  join('pflegen zu + Inf', 'иметь обыкновение', 'be in the habit of'),
  join('scheinen zu + Inf', 'казаться', 'seem to'),
  join('brauchen zu + Inf', 'не нужно (с nicht, nur)', 'not need to (with nicht, nur)'),
  join('vermögen zu + Inf', 'быть в состоянии', 'be able to'),
  join('drohen zu + Inf', 'грозить (что-то случится)', 'threaten to'),
  // A detail of the word: auf
  v('warten auf + Akk'), v('sich freuen auf + Akk'), v('hoffen auf + Akk'), v('sich konzentrieren auf + Akk'),
  v('sich vorbereiten auf + Akk'), v('reagieren auf + Akk'), v('antworten auf + Akk'),
  // über
  v('sich freuen über + Akk'), v('sich ärgern über + Akk'), v('sprechen über + Akk'), v('nachdenken über + Akk'),
  v('sich beschweren über + Akk'), v('lachen über + Akk'), v('sich informieren über + Akk'), v('diskutieren über + Akk'),
  // an
  v('denken an + Akk'), v('sich erinnern an + Akk'), v('glauben an + Akk'), v('schreiben an + Akk'),
  v('zweifeln an + Dat'), v('sterben an + Dat'), v('arbeiten an + Dat'),
  // vor, in
  v('sich fürchten vor + Dat'), v('warnen vor + Dat'), v('schützen vor + Dat'), v('sich verlieben in + Akk'),
  v('sich irren in + Dat'),
  // Fixed case
  v('sich interessieren für'), v('sich kümmern um'), v('sich beschäftigen mit'), v('sich bewerben um'),
  // Adjectives
  adj('stolz auf + Akk'), adj('böse auf + Akk'), adj('neidisch auf + Akk'), adj('gespannt auf + Akk'),
  adj('froh über + Akk'), adj('verliebt in + Akk'), adj('interessiert an + Dat'), adj('abhängig von'),
  adj('bereit zu'), adj('verantwortlich für'),
  // Nouns
  noun('Angst vor + Dat'), noun('Lust auf + Akk'), noun('Hoffnung auf + Akk'), noun('Interesse an + Dat'),
  noun('Kritik an + Dat'), noun('Teilnahme an + Dat'), noun('Freude an + Dat'), noun('Erinnerung an + Akk'),
  noun('Gedanke an + Akk'),
];

/** "Sich Freuen" → "freuen": pairs are found with or without "sich". */
const pairKey = (base: string) => baseOfReflexive(base.trim().replace(/\s+/g, ' ')).toLowerCase();

const PAIRS_BY_BASE = new Map<string, PrepPair[]>();
for (const p of PREP_PAIRS) {
  const k = pairKey(p.base);
  PAIRS_BY_BASE.set(k, [...(PAIRS_BY_BASE.get(k) ?? []), p]);
}

/** The list's pairs for a word (with or without "sich"). */
export const pairsFor = (base: string): PrepPair[] => PAIRS_BY_BASE.get(pairKey(base)) ?? [];

/** The list's pair whose preposition is part of the word ("bestehen auf"), if this is one. */
export const joiningPair = (base: string, word: string): PrepPair | undefined =>
  pairsFor(base).find((p) => p.word === word && p.joins && isReflexiveTerm(p.base) === isReflexiveTerm(base));

/** A word of the list (any preposition): "stolz", "Angst". */
export const isPairBase = (base: string): boolean => PAIRS_BY_BASE.has(pairKey(base));

/** The case known without a dictionary: a fixed-case preposition's, else the list's. */
export function knownCase(base: string, word: string): { case: PrepCase; from: 'fixed' | 'list' } | null {
  const listed = pairsFor(base).find((p) => p.word === word);
  // "zu" + infinitive is the list's ("pflegen zu"); otherwise zu takes the dative.
  if (listed && (listed.case === 'Inf' || !FIXED_CASE.has(word))) return { case: listed.case, from: 'list' };
  if (FIXED_CASE.has(word)) return { case: PREP_CASE[word]!, from: 'fixed' };
  return null;
}

export type CaseFrom = 'typed' | 'fixed' | 'list' | 'lookup';

/**
 * The case after a word's preposition: what the user typed (a fixed-case preposition keeps its
 * own: "mit + Akk" is Dat; Inf only after zu), the fixed case, the list, then the dictionary's
 * entry for that preposition (`lookup`: Card.preps format). Nothing when none knows: the user
 * picks Akk / Dat.
 */
export function resolveCase(base: string, word: string, o: { typed?: PrepCase | null; lookup?: string } = {}): { case?: PrepCase; from?: CaseFrom } {
  const typed = o.typed ?? undefined;
  if (typed === 'Inf' ? word === 'zu' : typed && !FIXED_CASE.has(word)) return { case: typed, from: 'typed' };
  const known = knownCase(base, word);
  if (known) return known;
  const fromLookup = prepEntries(o.lookup).find((p) => p.word === word)?.case;
  if (fromLookup && fromLookup !== 'Inf') return { case: fromLookup, from: 'lookup' };
  return {};
}

/**
 * The list's prepositions that are a detail of this reading of the word (not `joins`: those are
 * words of their own): "denken" → an + Akk. A "sich …" term gets the reflexive pairs, a plain
 * one the others ("freuen über" is the reflexive reading's, not the plain verb's).
 */
export function listPreps(term: string, pos: Pos): PrepPart[] {
  const refl = isReflexiveTerm(term);
  return pairsFor(term)
    .filter((p) => !p.joins && p.pos === pos && isReflexiveTerm(p.base) === refl)
    .map((p) => ({ word: p.word, case: p.case }));
}

/**
 * A word's prepositions (Card.preps format) with the list's added: for a preposition both name,
 * the list's entry replaces the dictionary's (its case is hand-checked); the dictionary's order is
 * kept and the list's others follow. At most 3, the list's kept over the dictionary's others.
 * Unchanged (same string) when the list has nothing new.
 */
export function withListPreps(preps: string | undefined, term: string, pos: Pos): string {
  const listed = listPreps(term, pos);
  const own = (preps ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!listed.length) return preps ?? '';
  const out: { text: string; listed: boolean }[] = [];
  const seen = new Set<string>();
  for (const s of own) {
    const word = parsePrepEntry(s)?.word;
    const l = word ? listed.find((p) => p.word === word) : undefined;
    const text = l ? formatPrep(l) : s;
    const key = word ?? s;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text, listed: !!l });
  }
  for (const l of listed) {
    if (seen.has(l.word)) continue;
    seen.add(l.word);
    out.push({ text: formatPrep(l), listed: true });
  }
  while (out.length > 3) {
    const i = out.map((x) => x.listed).lastIndexOf(false);
    out.splice(i < 0 ? out.length - 1 : i, 1);
  }
  const joined = out.map((x) => x.text).join('; ');
  return joined === own.join('; ') ? (preps ?? '') : joined;
}
