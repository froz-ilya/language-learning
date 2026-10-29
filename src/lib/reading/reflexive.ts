/**
 * Reflexive verbs in running text ("Wir treffen uns" → sich treffen): a reflexive pronoun and a
 * verb of the same clause whose dictionary entry is used with "sich" (LexEntry.reflexive).
 *
 * Heuristics, per clause segment (text between punctuation, split at "und"/"oder"/…) that holds
 * a reflexive pronoun (mich, dich, sich, uns, euch, mir, dir):
 * - The pronoun must not follow a preposition ("an sich", "mit uns"), and must agree with the
 *   subject: a personal pronoun before it (ich → mich/mir, du → dich/dir, wir → uns, ihr → euch,
 *   er/sie/es/Sie/man → sich), else "sich" (a noun subject); a verb-first segment at the start of
 *   a sentence is an imperative or a question (dich, dir, euch, sich); a segment that continues a
 *   sentence ("…und ziehe mich an") also takes the sentence's subject; a zu-infinitive any.
 * - The verb: in a main clause the nearest verb before the pronoun ("Morgen treffen wir uns");
 *   after an auxiliary or modal the verb at the end ("Er hat sich beeilt" → beeilt), in a
 *   subordinate clause the verb after the pronoun ("…, weil wir uns treffen").
 * - A verb split from its particle (separable.ts) counts as the joined verb ("Ich ziehe mich
 *   schnell an" → sich anziehen, three tokens); its plain verb is then not tried.
 * Capitalised words are only verbs at the start of a sentence ("Treffen wir uns?").
 */
import { lookupLocal } from '../dict/local';
import type { LexEntry, LocalHit } from '../dict/types';
import { asReflexive, REFLEXIVE_PRONOUNS } from '../german/reflexive';
import { PARTICLES, type Lookup, type SplitVerb } from './separable';
import type { Token } from './text';

/** A reflexive verb in one paragraph's token list. */
export interface ReflexiveVerb {
  /** Index of the verb token that carries the meaning ("treffen", "beeilt", "ziehe" of anziehen). */
  verb: number;
  /** Index of the reflexive pronoun ("uns"). */
  pronoun: number;
  /** Index of the separated particle when the verb is split ("an" of "ziehe mich … an"). */
  particle?: number;
  /** The verb read reflexively: asReflexive(entry), term "sich treffen". */
  entry: LexEntry;
}

/** Non-word token that ends a clause; …and one that ends a sentence (as in separable.ts). */
const CLAUSE_END = /[,;:.!?"„“”«»‚‘()[\]{}…–—]|\s-\s/;
const SENTENCE_END = /[.!?:"„“”«»…]/;
/** Coordinating conjunctions: a new segment, which may share the subject ("…und ziehe mich an"). */
const CONJUNCTIONS = new Set(['und', 'oder', 'sondern', 'sowie', 'aber']);
/** First words of subordinate clauses (verb last). Relative/question words only after a comma. */
const SUBORDINATORS = new Set([
  'dass', 'daß', 'weil', 'ob', 'obwohl', 'obgleich', 'obschon', 'nachdem', 'bevor', 'ehe', 'falls', 'sofern',
  'sobald', 'solange', 'sodass', 'indem', 'wenn', 'als', 'damit', 'seit', 'seitdem', 'bis', 'während', 'wo',
]);
const RELATIVES = new Set([
  'der', 'die', 'das', 'den', 'dem', 'deren', 'dessen', 'denen', 'welcher', 'welche', 'welches', 'welchen', 'welchem',
  'was', 'wer', 'wen', 'wem', 'wie', 'wann', 'warum', 'weshalb', 'wieso', 'woher', 'wohin', 'womit', 'wofür', 'worüber',
  'woran', 'worauf', 'wobei',
]);
/** Starts of zu-infinitive clauses ("um sich zu erholen"): not prepositions there. */
const INFINITIVE_INTRO = new Set(['um', 'ohne', 'statt', 'anstatt']);
/** A pronoun after one of these is an object of the preposition ("an sich", "mit uns"). */
const PREPOSITIONS = new Set([
  'an', 'auf', 'aus', 'bei', 'durch', 'für', 'gegen', 'hinter', 'in', 'mit', 'nach', 'neben', 'ohne', 'über', 'um',
  'unter', 'von', 'vor', 'zu', 'zwischen', 'gegenüber', 'außer', 'seit', 'wegen', 'trotz', 'statt', 'anstatt', 'ab',
  'bis', 'entlang', 'zuliebe', 'dank', 'laut', 'samt', 'nebst',
]);
/** Auxiliaries and modals: the meaning is in the verb at the end ("Er hat sich beeilt"). */
const AUXILIARIES = new Set(['haben', 'sein', 'werden', 'können', 'müssen', 'wollen', 'sollen', 'dürfen', 'mögen', 'möchten']);
/** Articles and possessives: a lower-case word between one and a noun is an adjective. */
const DETERMINERS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines', 'kein', 'keine',
  'keinen', 'keinem', 'keiner', 'keines', 'mein', 'meine', 'meinen', 'meinem', 'meiner', 'meines', 'dein', 'deine',
  'deinen', 'deinem', 'deiner', 'deines', 'sein', 'seine', 'seinen', 'seinem', 'seiner', 'seines', 'ihr', 'ihre',
  'ihren', 'ihrem', 'ihrer', 'ihres', 'unser', 'unsere', 'unseren', 'unserem', 'unserer', 'euer', 'eure', 'euren',
  'eurem', 'eurer', 'dieser', 'diese', 'diesen', 'diesem', 'dieses', 'jeder', 'jede', 'jeden', 'jedem', 'jedes',
]);

/** Who the subject is, as far as the pronoun agreement goes. */
type Person = '1s' | '2s' | '3' | '1p' | '2p';
const SUBJECTS: Record<string, Person> = { ich: '1s', du: '2s', er: '3', sie: '3', es: '3', man: '3', wir: '1p', ihr: '2p' };
const AGREES: Record<Person, string[]> = {
  '1s': ['mich', 'mir'],
  '2s': ['dich', 'dir'],
  '3': ['sich'],
  '1p': ['uns'],
  '2p': ['euch'],
};
/** Imperatives and verb-first questions without a subject pronoun ("Beeil dich!", "Freut sich der Mann?"). */
const IMPERATIVE = ['dich', 'dir', 'euch', 'sich'];

/** A token read as a verb: its reflexive entry (null when not used with "sich") and split particle. */
interface VerbReading {
  entry: LexEntry | null;
  particle?: number;
}

/** Words before an imperative ("Nun legt euch hin", "Bitte setzen Sie sich"). */
const IMPERATIVE_LEAD = new Set(['nun', 'jetzt', 'dann', 'bitte', 'doch', 'also', 'so', 'da', 'mal', 'nur', 'endlich', 'schnell']);

/**
 * Whether `term` is a separable compound (particle + verb) that `word` doesn't start with, so
 * `word` can only be its split finite verb ("ziehe" → anziehen). "angezogen", "anziehe" and
 * "geeinigt" (einigen) keep theirs.
 */
function separatedFrom(term: string, word: string): boolean {
  for (let n = Math.min(term.length - 3, 12); n >= 2; n--) {
    const p = term.slice(0, n);
    if (PARTICLES.has(p)) return !word.startsWith(p) && !word.startsWith(`ge${p}`);
  }
  return false;
}

const isLower = (s: string) => s[0] === s[0].toLowerCase() && s[0] !== s[0].toUpperCase();

/** One clause: its word segments (split at conjunctions) and whether it starts a sentence. */
interface Clause {
  segments: number[][];
  sentenceStart: boolean;
}

/** A paragraph's word tokens grouped into clauses (as separable.ts does). */
function clauses(tokens: Token[]): Clause[] {
  const out: Clause[] = [];
  let cur: Clause = { segments: [[]], sentenceStart: true };
  const close = (sentenceEnd: boolean) => {
    if (cur.segments.some((s) => s.length)) out.push({ ...cur, segments: cur.segments.filter((s) => s.length) });
    cur = { segments: [[]], sentenceStart: sentenceEnd };
  };
  tokens.forEach((t, i) => {
    if (!t.word) {
      const empty = !cur.segments.some((s) => s.length);
      if (CLAUSE_END.test(t.text)) close(SENTENCE_END.test(t.text) || (cur.sentenceStart && empty));
    } else if (CONJUNCTIONS.has(t.text.toLowerCase())) {
      if (cur.segments[cur.segments.length - 1].length) cur.segments.push([]);
    } else cur.segments[cur.segments.length - 1].push(i);
  });
  close(true);
  return out;
}

/**
 * Reflexive verbs of one paragraph with an injectable lookup (cached per call through `cache`)
 * and the paragraph's split verbs. Lookup errors propagate; reflexiveVerbs() catches them.
 */
export async function findReflexives(
  tokens: Token[],
  lookup: Lookup,
  splits: Map<number, SplitVerb> = new Map(),
  cache = new Map<string, Promise<LocalHit[]>>(),
): Promise<Map<number, ReflexiveVerb>> {
  const out = new Map<number, ReflexiveVerb>();
  const text = (i: number) => tokens[i].text;
  const lower = (i: number) => tokens[i].text.toLowerCase();
  const isPronoun = (i: number) => lower(i) in REFLEXIVE_PRONOUNS;
  // Most paragraphs have no reflexive pronoun at all: nothing to look up.
  if (!tokens.some((t, i) => t.word && isPronoun(i))) return out;

  const hitsOf = (w: string) => {
    let p = cache.get(w);
    if (!p) cache.set(w, (p = lookup(w)));
    return p;
  };
  /** The verb lemma `term` exactly, or null. */
  const verbLemma = async (term: string) =>
    (await hitsOf(term)).find((h) => !h.form && h.entry.term === term && h.entry.pos === 'verb')?.entry ?? null;

  /**
   * A token read as a verb: whether it is one, and its reflexive entry (null when the verb isn't
   * used with "sich"). A split verb is its joined verb; `initial` allows a capitalised word and an
   * imperative stem ("Beeil" → beeilen).
   */
  const verbAt = async (i: number, initial: boolean): Promise<VerbReading | null> => {
    const split = splits.get(i);
    if (split && split.verb === i) return { entry: split.entry.reflexive ? split.entry : null, particle: split.particle };
    const w = text(i);
    if (!isLower(w) && !initial) return null;
    const lw = w.toLowerCase();
    // Separable compounds among the forms ("ziehe" → anziehen, "regte" → aufregen) only count
    // when the word has the particle ("angezogen", "anziehe"); split ones come from `splits`.
    const hits = await hitsOf(w);
    // A word that is itself an adverb, pronoun, … ("schon", not schonen; "morgen").
    if (hits[0] && !hits[0].form && hits[0].entry.pos === 'other' && hits[0].entry.term.toLowerCase() === lw) return null;
    const verbs = hits.map((h) => h.entry).filter((e) => e.pos === 'verb' && !separatedFrom(e.term, lw));
    if (!verbs.length && initial) {
      for (const end of ['en', 'n']) {
        const e = await verbLemma(lw + end);
        if (!e) continue;
        verbs.push(e);
        break;
      }
    }
    if (!verbs.length) return null;
    return { entry: verbs.find((e) => e.reflexive) ?? null };
  };

  /**
   * No verb here: an article or possessive ("hat mich meine Frau …": not meinen), or a lower-case
   * word between one and a capitalised noun with an adjective ending.
   */
  const adjectival = (seg: number[], n: number) => {
    const prev = seg[n - 1];
    const next = seg[n + 1];
    if (DETERMINERS.has(lower(seg[n]))) return true;
    return (
      prev !== undefined &&
      DETERMINERS.has(lower(prev)) &&
      next !== undefined &&
      !isLower(text(next)) &&
      /e[nmrs]?$/.test(text(seg[n]))
    );
  };

  /** The subject pronoun among the segment's first `upto` words. */
  const subjectOf = (seg: number[], upto: number): Person | null => {
    for (let n = 0; n < upto; n++) {
      const w = lower(seg[n]);
      const p = SUBJECTS[w];
      if (!p) continue;
      // "Ihr Vater": a possessive, not the subject "ihr".
      if (w === 'ihr' && seg[n + 1] !== undefined && !isLower(text(seg[n + 1]))) continue;
      return p;
    }
    return null;
  };

  /** The subject of the sentence's main clauses so far, for clauses that continue it. */
  let sentenceSubject: Person | null = null;
  for (const clause of clauses(tokens)) {
    const first = clause.segments[0][0];
    const subordinate =
      SUBORDINATORS.has(lower(first)) || (!clause.sentenceStart && RELATIVES.has(lower(first)) && isLower(text(first)));
    if (clause.sentenceStart) sentenceSubject = null;
    /** The subject of this clause so far ("weil er kam und sich setzte"). */
    let clauseSubject: Person | null = null;
    for (let s = 0; s < clause.segments.length; s++) {
      const seg = clause.segments[s];
      const sentenceStart = s === 0 && clause.sentenceStart;
      const own = subjectOf(seg, seg.length);
      const inherited = clauseSubject ?? (subordinate ? null : sentenceSubject);
      for (let n = 0; n < seg.length; n++) {
        const pi = seg[n];
        if (!isPronoun(pi) || out.has(pi)) continue;
        const prev = seg[n - 1];
        if (prev !== undefined && PREPOSITIONS.has(lower(prev)) && !(n === 1 && INFINITIVE_INTRO.has(lower(prev)))) continue;
        const pronoun = lower(pi);

        // Verb candidates: the nearest verb before the pronoun, and the verbs after it.
        let before: { i: number; v: VerbReading } | null = null;
        for (let k = n - 1; k >= 0 && !before; k--) {
          const i = seg[k];
          if (out.has(i) || isPronoun(i) || adjectival(seg, k)) continue;
          const v = await verbAt(i, k === 0 && sentenceStart);
          if (v) before = { i, v };
        }
        const after: { i: number; v: VerbReading; zu: boolean }[] = [];
        for (let k = n + 1; k < seg.length; k++) {
          const i = seg[k];
          if (out.has(i) || isPronoun(i) || adjectival(seg, k)) continue;
          const v = await verbAt(i, false);
          if (v) after.push({ i, v, zu: k > 0 && lower(seg[k - 1]) === 'zu' });
        }

        // Agreement with the subject. Auxiliaries and modals have no imperative ("will dich holen").
        const aux = !!before && (await isAuxiliary(before.i));
        const subject = subjectOf(seg, n);
        // A zu-infinitive ("um sich zu erholen", "…, sich zu beeilen") takes any pronoun.
        const zu = after.some((a) => a.zu);
        const infinitive = !subject && (INFINITIVE_INTRO.has(lower(seg[0])) || zu || (n === 0 && !sentenceStart));
        // Verb first: sharing the subject before it ("…und ziehe mich an"), else an imperative or
        // a question ("Beeil dich!", "Nun legt euch hin"); a noun subject may follow ("Freut sich …?").
        const at = before ? seg.indexOf(before.i) : -1;
        let allowed: string[];
        if (subject) allowed = AGREES[subject];
        else if (infinitive) allowed = Object.keys(REFLEXIVE_PRONOUNS);
        else if (at === 0) allowed = inherited ? [...AGREES[inherited], 'sich'] : aux ? AGREES['3'] : IMPERATIVE;
        else if (at === 1 && IMPERATIVE_LEAD.has(lower(seg[0]))) allowed = IMPERATIVE;
        else allowed = AGREES['3'];
        if (!allowed.includes(pronoun)) continue;

        // The verb: after an auxiliary / in a subordinate clause the one after the pronoun.
        // An auxiliary is never the reflexive verb itself ("es hatte sich …" is no "sich haben").
        const order = aux ? after : subordinate || !before || zu ? [...after, ...(before ? [before] : [])] : [before];
        const hit = order.find((c) => c.v.entry);
        if (!hit) continue;
        const r: ReflexiveVerb = { verb: hit.i, pronoun: pi, entry: asReflexive(hit.v.entry!) };
        if (hit.v.particle !== undefined) r.particle = hit.v.particle;
        out.set(hit.i, r).set(pi, r);
        if (r.particle !== undefined) out.set(r.particle, r);
      }
      if (own) clauseSubject = own;
      if (own && !subordinate) sentenceSubject = own;
    }
  }
  return out;

  async function isAuxiliary(i: number): Promise<boolean> {
    if (splits.get(i)) return false;
    return (await hitsOf(text(i))).some((h) => h.entry.pos === 'verb' && AUXILIARIES.has(h.entry.term));
  }
}

/**
 * Reflexive verbs of every paragraph: one map per paragraph, token index → ReflexiveVerb, holding
 * the verb's, the pronoun's and (if split) the particle's index, all pointing to the same object.
 * `splits` are the paragraphs' split verbs (splitVerbs()). Never throws.
 */
export async function reflexiveVerbs(
  paragraphs: Token[][],
  splits: (Map<number, SplitVerb> | undefined)[] = [],
): Promise<Map<number, ReflexiveVerb>[]> {
  const cache = new Map<string, Promise<LocalHit[]>>();
  const lookup: Lookup = (w) => lookupLocal(w).catch(() => []);
  const out: Map<number, ReflexiveVerb>[] = [];
  for (let i = 0; i < paragraphs.length; i += 8) {
    const batch = paragraphs.slice(i, i + 8);
    out.push(
      ...(await Promise.all(
        batch.map((p, j) => findReflexives(p, lookup, splits[i + j], cache).catch(() => new Map<number, ReflexiveVerb>())),
      )),
    );
  }
  return out;
}

/** Tokens as written, in text order: neighbours joined by a space, gaps by " … " ("ziehe mich … an"). */
export function joinedText(tokens: Token[], indices: number[]): string {
  const list = [...new Set(indices)].sort((a, b) => a - b);
  let s = '';
  list.forEach((t, k) => {
    if (k) {
      const prev = list[k - 1];
      const adjacent = t === prev + 2 && !tokens[prev + 1].text.trim();
      s += adjacent ? ' ' : ' … ';
    }
    s += tokens[t].text;
  });
  return s;
}

/** The reflexive verb as written: "treffen uns", "Treffen … uns", "ziehe mich … an". */
export function reflexiveText(tokens: Token[], r: ReflexiveVerb): string {
  return joinedText(tokens, r.particle === undefined ? [r.verb, r.pronoun] : [r.verb, r.pronoun, r.particle]);
}

/** A verb written as several tokens: a split verb or a reflexive verb (with its particle). */
export interface VerbGroup {
  /** The verb token: where the group counts (new words) and whose sentence is the context. */
  verb: number;
  /** All its tokens, in text order. */
  tokens: number[];
  /** The joined verb: anrufen, sich treffen, sich anziehen. */
  entry: LexEntry;
}

/**
 * Split and reflexive verbs of one paragraph as groups, token index → group. A reflexive verb
 * wins over a split verb that shares a token with it (it includes the particle).
 */
export function verbGroups(splits?: Map<number, SplitVerb>, reflexives?: Map<number, ReflexiveVerb>): Map<number, VerbGroup> {
  const out = new Map<number, VerbGroup>();
  for (const r of new Set(reflexives?.values() ?? [])) {
    const ids = [r.verb, r.pronoun, ...(r.particle === undefined ? [] : [r.particle])].sort((a, b) => a - b);
    const g: VerbGroup = { verb: r.verb, tokens: ids, entry: r.entry };
    for (const t of ids) out.set(t, g);
  }
  for (const s of new Set(splits?.values() ?? [])) {
    if (out.has(s.verb) || out.has(s.particle)) continue;
    const g: VerbGroup = { verb: s.verb, tokens: [s.verb, s.particle].sort((a, b) => a - b), entry: s.entry };
    out.set(s.verb, g).set(s.particle, g);
  }
  return out;
}

/** A group as written ("rufe … an", "treffen uns"). */
export const groupText = (tokens: Token[], g: VerbGroup): string => joinedText(tokens, g.tokens);
