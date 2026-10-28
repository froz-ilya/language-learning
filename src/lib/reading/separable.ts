/**
 * Separable verbs split across a clause ("Ich rufe dich morgen an" → anrufen): the finite verb
 * and its particle are found per clause and confirmed against the offline dictionary.
 *
 * Heuristics: a clause (text between punctuation; "und"/"oder"/"sondern" start a new segment)
 * qualifies when its last word is a separable particle. The verb is a word before it whose
 * dictionary reading joined with the particle is a verb lemma: particle + lemma ("rufe" → rufen →
 * anrufen), the joined form ("an" + "rief" → anrief → anrufen) or, for a clause-initial
 * imperative, particle + stem + "en" ("Ruf … an" → anrufen). Words that read as verbs are tried
 * first, so "Lange sah er sie an" gives ansehen, not anlangen. Capitalised words are only tried
 * at the start of a sentence (mid-sentence they are nouns). A segment without a verb of its own
 * borrows the one of an earlier segment ("Ich kaufe Brot und Milch ein"). Subordinate clauses,
 * "hin und her" and "auf- und ab…" are skipped.
 */
import { lookupLocal } from '../dict/local';
import type { LexEntry, LocalHit } from '../dict/types';
import type { Token } from './text';

/** A verb and its separated particle in one paragraph's token list. */
export interface SplitVerb {
  /** Index of the finite verb token ("rufe"). */
  verb: number;
  /** Index of the particle token ("an"). */
  particle: number;
  /** Dictionary entry of the joined verb (anrufen). */
  entry: LexEntry;
}

/** Same contract as lookupLocal(): hits for a word, best first; [] when unknown. */
export type Lookup = (word: string) => Promise<LocalHit[]>;

/** Separable particles; a wrong one costs a few lookups, the dictionary check filters it out. */
export const PARTICLES = new Set([
  'ab', 'an', 'auf', 'aus', 'bei', 'dar', 'durch', 'ein', 'fort', 'los', 'mit', 'nach', 'nieder', 'um', 'unter',
  'über', 'vor', 'weg', 'wider', 'zu',
  // Compound adverbs.
  'her', 'hin', 'herab', 'heran', 'herauf', 'heraus', 'herbei', 'herein', 'herüber', 'herum', 'herunter', 'hervor',
  'hinab', 'hinauf', 'hinaus', 'hinein', 'hinüber', 'hinunter', 'hinweg', 'hinzu', 'hinterher', 'rein', 'raus',
  'rauf', 'runter', 'rüber', 'rum', 'voran', 'voraus', 'vorbei', 'vorweg', 'vorüber', 'weiter', 'wieder', 'zurück',
  'zurecht', 'zusammen', 'auseinander', 'entgegen', 'entlang', 'gegenüber', 'umher', 'empor', 'überein', 'bevor',
  'dabei', 'dazu', 'davon', 'daher', 'dahin', 'heim',
  // Nouns and adjectives used as particles.
  'fest', 'frei', 'hoch', 'fern', 'fehl', 'kaputt', 'offen', 'fertig', 'bereit', 'nahe', 'statt', 'teil', 'stand',
  'preis', 'leid', 'kennen',
]);

/** Non-word token that ends a clause: punctuation, quotes, brackets, dashes. */
const CLAUSE_END = /[,;:.!?"„“”«»‚‘()[\]{}…–—]|\s-\s/;
/** …and a sentence, after which a capitalised word may be a verb ("Ruf mich an!"). */
const SENTENCE_END = /[.!?:"„“”«»…]/;
/** Coordinating conjunctions between two main clauses without a comma ("Er steht auf und geht los"). */
const CONJUNCTIONS = new Set(['und', 'oder', 'sondern', 'sowie']);
/** Subordinate clauses have the verb last and joined ("weil er morgen anruft"): skipped. */
const SUBORDINATORS = new Set([
  'dass', 'daß', 'weil', 'ob', 'obwohl', 'obgleich', 'obschon', 'nachdem', 'bevor', 'ehe', 'falls', 'sofern',
  'sobald', 'solange', 'sodass', 'indem', 'wenn',
]);

/** Articles and possessives: a lower-case word between one and a noun is an adjective. */
const DETERMINERS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines', 'kein', 'keine',
  'keinen', 'keinem', 'keiner', 'keines', 'mein', 'meine', 'meinen', 'meinem', 'meiner', 'meines', 'dein', 'deine',
  'deinen', 'deinem', 'deiner', 'deines', 'sein', 'seine', 'seinen', 'seinem', 'seiner', 'seines', 'ihr', 'ihre',
  'ihren', 'ihrem', 'ihrer', 'ihres', 'unser', 'unsere', 'unseren', 'unserem', 'unserer', 'euer', 'eure', 'euren',
  'eurem', 'eurer', 'dieser', 'diese', 'diesen', 'diesem', 'dieses', 'jeder', 'jede', 'jeden', 'jedem', 'jedes',
]);

const isLower = (s: string) => s[0] === s[0].toLowerCase() && s[0] !== s[0].toUpperCase();

/** One clause: its word segments (split at conjunctions) and whether it starts a sentence. */
interface Clause {
  segments: number[][];
  sentenceStart: boolean;
}

/** A paragraph's word tokens grouped into clauses. */
function clauses(tokens: Token[]): Clause[] {
  const out: Clause[] = [];
  let cur: Clause = { segments: [[]], sentenceStart: true };
  const close = (sentenceEnd: boolean) => {
    if (cur.segments.some((s) => s.length)) out.push({ ...cur, segments: cur.segments.filter((s) => s.length) });
    cur = { segments: [[]], sentenceStart: sentenceEnd };
  };
  tokens.forEach((t, i) => {
    if (!t.word) {
      // An opening quote or bracket before the first word keeps the sentence start.
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
 * Split verbs of one paragraph with an injectable lookup (cached per call through `cache`).
 * Lookup errors propagate; splitVerbs() catches them.
 */
export async function findSplitVerbs(
  tokens: Token[],
  lookup: Lookup,
  cache = new Map<string, Promise<LocalHit[]>>(),
): Promise<Map<number, SplitVerb>> {
  const hitsOf = (w: string) => {
    let p = cache.get(w);
    if (!p) cache.set(w, (p = lookup(w)));
    return p;
  };
  /** The verb lemma `compound` exactly, or null. */
  const verbLemma = async (compound: string) =>
    (await hitsOf(compound)).find((h) => !h.form && h.entry.term === compound && h.entry.pos === 'verb')?.entry ?? null;

  /** Joined verb for a token and particle, or null. */
  const joined = async (text: string, particle: string, imperative: boolean, hits: LocalHit[]) => {
    const verbs = hits.map((h) => h.entry).filter((e) => e.pos === 'verb');
    for (const e of verbs) {
      // Skip compounds among the hits ("ging" → umgehen next to gehen: "her" + umgehen is wrong).
      if (verbs.some((b) => b !== e && e.term.endsWith(b.term) && PARTICLES.has(e.term.slice(0, -b.term.length)))) continue;
      const compound = await verbLemma(particle + e.term);
      if (compound) return compound;
    }
    // The joined form ("anrief"); its lemma must be particle + a known verb, since ending rules
    // also turn "nahe" + "er" into nahen.
    const lower = text.toLowerCase();
    for (const h of await hitsOf(particle + lower)) {
      const { term, pos } = h.entry;
      if (pos === 'verb' && term.startsWith(particle) && (await verbLemma(term.slice(particle.length)))) return h.entry;
    }
    // An imperative read as a noun ("Ruf mich an": Ruf → rufen), when stem + "en" is a verb too.
    if (imperative) {
      for (const end of ['en', 'n']) {
        if (!(await verbLemma(lower + end))) continue;
        const e = await verbLemma(particle + lower + end);
        if (e) return e;
      }
    }
    return null;
  };

  const out = new Map<number, SplitVerb>();
  const isParticle = (i: number | undefined) => i !== undefined && PARTICLES.has(tokens[i].text.toLowerCase());

  /** Candidate verbs among the first `last` words of a segment, with their dictionary hits. */
  const candidates = async (clause: Clause, k: number, last: number) => {
    const seg = clause.segments[k];
    const picked: { i: number; imperative: boolean }[] = [];
    for (let n = 0; n < last; n++) {
      const i = seg[n];
      const text = tokens[i].text;
      if (out.has(i)) continue;
      // Capitalised mid-sentence: a noun (or "Sie").
      if (!isLower(text) && !(k === 0 && n === 0 && clause.sentenceStart)) continue;
      // An adjective between an article and its noun ("die weisen Frauen") is no verb; "Das
      // kommt Anna komisch vor" is (no adjective ending).
      const prev = seg[n - 1];
      const next = seg[n + 1];
      const determined = prev !== undefined && DETERMINERS.has(tokens[prev].text.toLowerCase());
      if (determined && next !== undefined && !isLower(tokens[next].text) && /e[nmrs]?$/.test(text)) continue;
      picked.push({ i, imperative: n === 0 });
    }
    const hits = await Promise.all(picked.map((w) => hitsOf(tokens[w.i].text)));
    return picked.map((w, j) => {
      const text = tokens[w.i].text;
      // Nouns don't count for a lower-case word.
      const best = hits[j].find((h) => h.entry.pos !== 'noun' || !isLower(text));
      return { ...w, hits: hits[j], verb: best?.entry.pos === 'verb', known: hits[j].length > 0 };
    });
  };

  for (const clause of clauses(tokens)) {
    const { segments } = clause;
    if (SUBORDINATORS.has(tokens[segments[0][0]].text.toLowerCase())) continue;
    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      const pi = seg[seg.length - 1];
      const particle = tokens[pi].text.toLowerCase();
      if (!PARTICLES.has(particle) || !isLower(tokens[pi].text)) continue;
      if (seg.length > 1 && SUBORDINATORS.has(tokens[seg[0]].text.toLowerCase())) continue;
      // "auf- und abladen": a shortened compound.
      if (/^[-‐]/.test(tokens[pi + 1]?.text ?? '')) continue;
      // "hin und her", "ab und zu": a pair of particles, not the end of a clause.
      const prev = segments[s - 1];
      if (isParticle(segments[s + 1]?.[0]) || (seg.length === 1 && prev && isParticle(prev[prev.length - 1]))) continue;
      // Words before the particle; verb readings first ("Lange sah er sie an": sah, not lange).
      let words = await candidates(clause, s, seg.length - 1);
      // No verb in this segment: it shares the verb of an earlier one ("Ich kaufe Brot und Milch
      // ein"). Not when a word here is unknown: it may be the verb ("und schloß das Tor zu").
      if (!words.some((w) => w.verb || !w.known)) {
        for (let k = s - 1; k >= 0; k--) words = words.concat(await candidates(clause, k, segments[k].length));
      }
      words.sort((a, b) => Number(b.verb) - Number(a.verb));
      for (const w of words) {
        const entry = await joined(tokens[w.i].text, particle, w.imperative, w.hits);
        if (!entry) continue;
        const pair: SplitVerb = { verb: w.i, particle: pi, entry };
        out.set(w.i, pair);
        out.set(pi, pair);
        break;
      }
    }
  }
  return out;
}

/**
 * Split verbs of every paragraph: one map per paragraph, token index → SplitVerb, holding both
 * the verb's and the particle's index (pointing to the same object). Never throws.
 */
export async function splitVerbs(paragraphs: Token[][]): Promise<Map<number, SplitVerb>[]> {
  const cache = new Map<string, Promise<LocalHit[]>>();
  const lookup: Lookup = (w) => lookupLocal(w).catch(() => []);
  const out: Map<number, SplitVerb>[] = [];
  // Small batches: lookups load dictionary pieces lazily.
  for (let i = 0; i < paragraphs.length; i += 8) {
    const batch = paragraphs.slice(i, i + 8);
    out.push(...(await Promise.all(batch.map((p) => findSplitVerbs(p, lookup, cache).catch(() => new Map())))));
  }
  return out;
}

/** The pair as written, for display: "rufe … an" ("Ruf … an"), "hört auf" when adjacent. */
export function splitVerbText(tokens: Token[], s: SplitVerb): string {
  const adjacent = s.particle === s.verb + 2 && !tokens[s.verb + 1].text.trim();
  return `${tokens[s.verb].text}${adjacent ? ' ' : ' … '}${tokens[s.particle].text}`;
}
