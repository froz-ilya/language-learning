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
 *
 * A joined verb whose base verb isn't in the dictionary (auffächern without fächern, anstrengen)
 * counts when the word is its regular finite form ("fächerte" → fächern) and no other word class
 * (Candidate.plain), or the entry's own Präteritum ("wog ab" → abwägen). Ending rules alone would
 * read "hin" + "der" as hindern.
 */
import { lookupLocal } from '../dict/local';
import type { LexEntry, LocalHit } from '../dict/types';
import { REFLEXIVE_PRONOUNS, withSich } from '../german/reflexive';
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

/** A word that may be the finite verb of a segment. */
interface Candidate {
  i: number;
  /** First in its segment: may be an imperative ("Ruf mich an"). */
  imperative: boolean;
  hits: LocalHit[];
  /** The word's best reading is a verb. */
  verb: boolean;
  /** The dictionary knows it (a lower-case word's noun hits don't count: they are ending rules). */
  known: boolean;
  /**
   * The word is no other word class: not itself an adverb, pronoun, … ("der"), a capitalised noun
   * ("Regen") or an adjective before its noun ("armen Leuten"). Only such a word can be the
   * form of a joined verb whose base verb the dictionary lacks.
   */
  plain: boolean;
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

/** The particle closing segment `s` of a clause (the segment's last word), or null. */
function finalParticle(tokens: Token[], { segments }: Clause, s: number): number | null {
  const isParticle = (i: number | undefined) => i !== undefined && PARTICLES.has(tokens[i].text.toLowerCase());
  const seg = segments[s];
  const pi = seg[seg.length - 1];
  if (!isParticle(pi) || !isLower(tokens[pi].text)) return null;
  if (seg.length > 1 && SUBORDINATORS.has(tokens[seg[0]].text.toLowerCase())) return null;
  // "auf- und abladen": a shortened compound.
  if (/^[-‐]/.test(tokens[pi + 1]?.text ?? '')) return null;
  // "hin und her", "ab und zu": a pair of particles, not the end of a clause.
  const prev = segments[s - 1];
  if (isParticle(segments[s + 1]?.[0]) || (seg.length === 1 && prev && isParticle(prev[prev.length - 1]))) return null;
  return pi;
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
  const joined = async (text: string, particle: string, imperative: boolean, hits: LocalHit[], plain: boolean) => {
    const verbs = hits.map((h) => h.entry).filter((e) => e.pos === 'verb');
    for (const e of verbs) {
      // Skip compounds among the hits ("ging" → umgehen next to gehen: "her" + umgehen is wrong).
      if (verbs.some((b) => b !== e && e.term.endsWith(b.term) && PARTICLES.has(e.term.slice(0, -b.term.length)))) continue;
      const compound = await verbLemma(particle + e.term);
      if (compound) return compound;
    }
    // The joined form ("anrief"); its lemma must be particle + a known verb or, as ending rules
    // also turn "nahe" + "er" into nahen, one the word is a form of ("fächerte" → auffächern).
    const lower = text.toLowerCase();
    for (const h of await hitsOf(particle + lower)) {
      const { term, pos } = h.entry;
      if (pos !== 'verb' || !term.startsWith(particle)) continue;
      const base = term.slice(particle.length);
      if (await verbLemma(base)) return h.entry;
      if (plain && (lower === base || infinitiveOf(lower) === base)) return h.entry;
    }
    // A strong verb whose base isn't listed either: the entry names the split form ("wog ab").
    const listed = verbs.find((e) => e.praeteritum === `${lower} ${particle}`);
    if (listed) return listed;
    // An imperative read as a noun ("Ruf mich an": Ruf → rufen), when stem + "en" is a verb too
    // or the word is no noun ("Streng dich an": anstrengen without strengen).
    if (imperative) {
      for (const end of ['en', 'n']) {
        const e = await verbLemma(particle + lower + end);
        if (e && (plain || (await verbLemma(lower + end)))) return e;
      }
    }
    return null;
  };

  const out = new Map<number, SplitVerb>();

  /** Candidate verbs among the first `last` words of a segment, with their dictionary hits. */
  const candidates = async (clause: Clause, k: number, last: number) => {
    const seg = clause.segments[k];
    const picked: { i: number; imperative: boolean; nounAhead: boolean }[] = [];
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
      const nounAhead = next !== undefined && !isLower(tokens[next].text) && tokens[next].text !== 'Sie';
      if (determined && nounAhead && /e[nmrs]?$/.test(text)) continue;
      picked.push({ i, imperative: n === 0, nounAhead });
    }
    const hits = await Promise.all(picked.map((w) => hitsOf(tokens[w.i].text)));
    return picked.map(({ i, imperative, nounAhead }, j): Candidate => {
      const text = tokens[i].text;
      // Nouns don't count for a lower-case word.
      const best = hits[j].find((h) => h.entry.pos !== 'noun' || !isLower(text));
      const other = hits[j].some(({ entry: { pos }, form }) =>
        pos === 'adj' ? nounAhead : !form && (pos === 'other' || (pos === 'noun' && !isLower(text))),
      );
      return { i, imperative, hits: hits[j], verb: best?.entry.pos === 'verb', known: !!best, plain: !other };
    });
  };

  for (const clause of clauses(tokens)) {
    const { segments } = clause;
    if (SUBORDINATORS.has(tokens[segments[0][0]].text.toLowerCase())) continue;
    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      const pi = finalParticle(tokens, clause, s);
      if (pi === null) continue;
      const particle = tokens[pi].text.toLowerCase();
      // Words before the particle; verb readings first ("Lange sah er sie an": sah, not lange).
      let words = await candidates(clause, s, seg.length - 1);
      // No verb in this segment: it shares the verb of an earlier one ("Ich kaufe Brot und Milch
      // ein"). Not when a word here is unknown: it may be the verb ("und schloß das Tor zu").
      if (!words.some((w) => w.verb || !w.known)) {
        for (let k = s - 1; k >= 0; k--) words = words.concat(await candidates(clause, k, segments[k].length));
      }
      words.sort((a, b) => Number(b.verb) - Number(a.verb));
      for (const w of words) {
        const entry = await joined(tokens[w.i].text, particle, w.imperative, w.hits, w.plain);
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

/**
 * A split verb the offline dictionary can't confirm, around one token: a finite verb and the
 * clause-final particle ("fächerte … auf"), with the lemma to ask an online source about.
 */
export interface SplitGuess {
  verb: number;
  particle: number;
  /** Reflexive pronoun of the clause, when there is one ("fächerte sich … auf"). */
  pronoun?: number;
  /** Lemma to look up: "auffächern", or "sich auffächern" with a pronoun. */
  term: string;
}

/** Finite endings; `tet` and `test` may also be a stem in t + et / est ("wartet"). */
const FINITE_ENDINGS = ['test', 'ten', 'tet', 'te', 'st', 'en', 'e', 't'];
/** Stems of frequent strong, mixed and auxiliary verbs: no infinitive can be built from these. */
const IRREGULAR = new Set(
  `kam käm ging sah säh sieh gab gäb gib nahm nähm nimm fand fänd blieb lag läg saß säß stand stünd ständ hielt hält
  lief läuf fiel fäll zog zög trug trüg träg fuhr fähr schlug schlüg schläg schrieb sprach spräch sprich rief ließ läss
  hieß bat bät brach bräch brich warf würf wirf traf träf triff half hülf hilf las läs lies wuchs wächs flog flög floss
  floß schloss schloß schlief schläf stieg sang sank sprang trank zwang band wand drang rang hing fing fäng schien
  schwieg stieß stöß wies wich griff litt ritt schnitt schritt stritt glitt biss biß riss riß hob bot bog floh goss goß
  kroch roch schob schoss schoß schwor aß fraß friss iss maß miss sass trat tritt starb stirb warb wirb barg birg galt
  gilt stahl stiehl lud läd wusch wäsch grub gräb briet riet rät schuf blies bläs halt schwamm schwang schwand gann
  gonn sann spann lor tat tät tret dacht bracht kannt nannt rannt sandt wandt
  bin bist ist sind seid sei war wär hat hast hatt hätt hab wird wirst wurd würd werd kann könn konnt musst mußt muss
  muß müss müß soll sollt will woll wollt darf dürf durft mag mög mocht möcht weiß wisst wusst wußt`.split(/\s+/),
);
/** Words a finite ending would fit ("nicht", "heute", "neben"): never the verb of a guess. */
const NOT_VERBS = new Set(
  `alle allen aller viele vielen einige einigen beide beiden andere anderen anderem solche solchen manche manchen jene
  jenen welche welchen wenige wenigen mehrere mehreren ihnen selbst nicht jetzt heute gestern morgen gerne selten oben
  unten hinten vorne drinnen draußen drüben neben wegen eben gegen ohne seit zwischen deswegen vielleicht recht sonst
  meist fast erst zuerst zuletzt längst bitte dort fort weit fest zusammen aber andern lange gerade außen damit darin
  darum dagegen sogleich sofort`.split(/\s+/),
);
/** Particles that are adverbs or adjectives at the end of a clause ("da fragte sie wieder"). */
const LOOSE_PARTICLES = new Set(
  `wieder dabei dazu davon daher dahin bereit rein nahe kennen statt leid stand preis teil fertig offen`.split(/\s+/),
);
/** Prepositions a clause may start with; its first part reaches to the noun ("Am Ende"). */
const LEAD_PREPOSITIONS = new Set(
  `an am ans auf aufs aus bei beim durch für gegen hinter im in ins mit nach neben ohne seit über um unter von vom vor
  während wegen zu zum zur zwischen`.split(/\s+/),
);
/** More first words of subordinate clauses; relative and question words only after a comma. */
const LATE_VERB_STARTS = new Set(['als', 'damit', 'seit', 'seitdem', 'bis', 'während', 'wo']);
const RELATIVES = new Set(
  `der die das den dem deren dessen denen welcher welche welches welchen welchem was wer wen wem wie wann warum weshalb
  wieso woher wohin womit wofür worüber woran worauf wobei`.split(/\s+/),
);
/** Pronouns after a verb that stands first ("Fächere es auf"): the second place holds no verb. */
const AFTER_VERB = new Set(['es', 'ihn', 'ihm', 'sie', 'ihnen', 'du', 'ihr', 'wir', 'er']);
/** Subject pronouns and the reflexive pronouns that agree with them; anything else takes "sich". */
const REFLEXIVE_OF: Record<string, string[]> = { ich: ['mich', 'mir'], du: ['dich', 'dir'], wir: ['uns'], ihr: ['euch'] };
const SUBJECT_PRONOUNS = new Set([...Object.keys(REFLEXIVE_OF), 'er', 'sie', 'es', 'man']);
/** Reflexive pronouns of an imperative, which has no subject ("Fächere dich auf"). */
const IMPERATIVE_REFLEXIVE = ['dich', 'dir', 'euch'];

/**
 * Whether the words between an inverted verb and its reflexive pronoun are just the subject:
 * none ("teilte sich"), a pronoun or name ("teilte sie sich", "sah Anna sich"), or a noun with
 * its article ("teilte die Gruppe sich").
 */
export function onlySubject(tokens: Token[], words: number[]): boolean {
  if (!words.length) return true;
  const last = tokens[words[words.length - 1]].text;
  if (words.length === 1) return !isLower(last) || SUBJECT_PRONOUNS.has(last);
  return (
    DETERMINERS.has(tokens[words[0]].text.toLowerCase()) &&
    !isLower(last) &&
    words.slice(1, -1).every((w) => isLower(tokens[w].text))
  );
}

/** Whether a lower-cased form is one of IRREGULAR's, whatever its prefix ("geriet") and ending. */
function isIrregular(form: string): boolean {
  const word = form.replace(/^(?:be|ge|er|ent|emp|ver|zer)(?=.{3})/, '');
  return [form, word].some((w) =>
    ['', 'e', 'en', 't', 'et', 'st', 'est'].some((end) => w.endsWith(end) && IRREGULAR.has(w.slice(0, w.length - end.length))),
  );
}

/** A participle ("gelenkt", "eingeschüchtert", "wetzenden"): not a finite verb. */
const isParticiple = (form: string) =>
  /\S{3}ende[nmrs]?$/.test(form) ||
  (form.endsWith('t') && [...PARTICLES, ''].some((p) => form.startsWith(`${p}ge`) && form.length - p.length >= 6));

/**
 * The infinitive of a lower-cased weak finite form: fächerte → fächern, lenkte → lenken, wartete →
 * warten, handle → handeln. Null for irregular forms and when no ending fits; `bare` also takes
 * the imperative without an ending ("lenk", "fächer").
 */
function infinitiveOf(form: string, bare = false): string | null {
  if (isIrregular(form) || isParticiple(form)) return null;
  // Stems in -er/-el: fächern, handeln (not "probier" + en, "leer" + en).
  const liquid = /(?:[^aeiouäöü]|[ae]i|[aeä]u)e[rl]$/;
  if (form.length > 4 && form.endsWith('n') && liquid.test(form.slice(0, -1))) return form;
  const end = FINITE_ENDINGS.find((e) => form.endsWith(e) && form.length - e.length >= 3);
  if (!end && !bare) return null;
  let stem = end ? form.slice(0, -end.length) : form;
  if (end?.startsWith('t')) {
    // A stem in -t: "arbeitet", "bereite", "wartet", not "baute", "lenktet", "fächertet".
    const afterVowel = /[aeiouäöü]$/.test(stem) && !/[aeä]u$/.test(stem) && !stem.endsWith('e');
    const present = (end === 'tet' || end === 'test') && !/[kgpbmzße]$/.test(stem) && !liquid.test(stem);
    if (afterVowel || present) stem += 't';
  }
  // "wartete", "redest": the -e- before the ending.
  stem = stem.replace(/e$/, '');
  // "handl", "wandr": the -e- of the stem dropped.
  if (/[^aeiouäöüyhlr][lr]$/.test(stem)) stem = `${stem.slice(0, -1)}e${stem.slice(-1)}`;
  if (stem.length < 3 || !/[aeiouäöüy]/.test(stem) || IRREGULAR.has(stem)) return null;
  // No stem ends in a plain vowel ("damit", "schrien"); au, ei, eu and ie do ("baute", "knien").
  if (/(?<![aeäi])[aiou]$|(?<=[aeo])i$/.test(stem)) return null;
  return stem + (stem.length >= 4 && liquid.test(stem) ? 'n' : 'en');
}

/**
 * Index in `seg` of the word after a main clause's first part, where its verb stands: "Die kleine
 * Gruppe | teilte", "Am Ende | fächerte", "Frau Meier | lenkte", "Dann | lenkte".
 */
function secondPlace(tokens: Token[], seg: number[]): number {
  const start = tokens[seg[0]].text.toLowerCase() === 'aber' ? 1 : 0;
  const lead = tokens[seg[start]].text.toLowerCase();
  let n = start + 1;
  if (DETERMINERS.has(lead) || LEAD_PREPOSITIONS.has(lead)) while (n < seg.length && isLower(tokens[seg[n]].text)) n++;
  while (n < seg.length && !isLower(tokens[seg[n]].text)) n++;
  return n;
}

/** The reflexive pronoun that goes with the verb at seg[v], or undefined. */
function reflexiveAfter(tokens: Token[], seg: number[], v: number): number | undefined {
  const word = (n: number) => tokens[seg[n]].text.toLowerCase();
  // The last word is the particle.
  for (let n = v + 1; n < seg.length - 1; n++) {
    const pronoun = word(n);
    if (!(pronoun in REFLEXIVE_PRONOUNS)) continue;
    if (!onlySubject(tokens, seg.slice(v + 1, n))) return undefined;
    // "Ihr Vater": a possessive, not the subject "ihr".
    const isSubject = (k: number) => word(k) in REFLEXIVE_OF && (word(k) !== 'ihr' || isLower(tokens[seg[k + 1]].text));
    const subject = seg.findIndex((_, k) => k < n && isSubject(k));
    if (subject >= 0) return REFLEXIVE_OF[word(subject)].includes(pronoun) ? seg[n] : undefined;
    return pronoun === 'sich' || (v === 0 && IMPERATIVE_REFLEXIVE.includes(pronoun)) ? seg[n] : undefined;
  }
  return undefined;
}

/**
 * The split verb to try online for the tapped token `t`, or null. Offline, no lookups. `t` is the
 * verb, the particle or the pronoun of a main clause that ends in a particle; the verb's form must
 * give a weak infinitive (fächerte → fächern, not kam).
 */
export function splitGuess(tokens: Token[], t: number): SplitGuess | null {
  if (!tokens[t]?.word) return null;
  const clause = clauses(tokens).find((c) => c.segments.some((seg) => seg.includes(t)));
  if (!clause) return null;
  const s = clause.segments.findIndex((seg) => seg.includes(t));
  const seg = clause.segments[s];
  const particle = seg.length > 1 ? finalParticle(tokens, clause, s) : null;
  if (particle === null) return null;
  const text = (i: number) => tokens[i].text;
  const word = (i: number) => tokens[i].text.toLowerCase();
  if (LOOSE_PARTICLES.has(word(particle))) return null;
  // Subordinate clauses have the verb last and joined.
  const first = clause.segments[0][0];
  if (SUBORDINATORS.has(word(first)) || [first, seg[0]].some((i) => LATE_VERB_STARTS.has(word(i)))) return null;
  if (!clause.sentenceStart && RELATIVES.has(word(first)) && isLower(text(first))) return null;

  const head = seg.slice(0, -1);
  const sentenceStart = s === 0 && clause.sentenceStart;
  const closing = tokens.slice(particle + 1).find((x) => x.text.trim())?.text ?? '';
  const second = word(seg[1]);
  // Verb first: an imperative or a question, or a clause sharing the subject ("…, fächerte es
  // auf"). Two words alone are a noun as often: "Augen auf!", "Tür zu!".
  const objectNext = DETERMINERS.has(second) || AFTER_VERB.has(second) || second in REFLEXIVE_PRONOUNS;
  const verbFirst = sentenceStart ? head.length > 1 && (/[!?]/.test(closing) || objectNext) : isLower(text(seg[0]));
  const place = seg[secondPlace(tokens, seg)];
  const verbLike = (i: number) => {
    const w = word(i);
    if (NOT_VERBS.has(w) || DETERMINERS.has(w) || LEAD_PREPOSITIONS.has(w) || w in REFLEXIVE_PRONOUNS) return false;
    const n = seg.indexOf(i);
    const next = seg[n + 1];
    if (next === particle || isLower(text(next)) || text(next) === 'Sie' || (!n && sentenceStart)) return true;
    // Before a noun an adjective, not the verb: "die kleine Gruppe", "…, kleine Karten"; elsewhere
    // the endings a past verb hasn't ("mit kleinen Karten", but "fächerte Karten").
    const determined = !n || DETERMINERS.has(word(seg[n - 1])) || NOT_VERBS.has(word(seg[n - 1]));
    return !(determined ? /e[nmrs]?$/ : /e(?:r?n|[mrs])$/).test(w);
  };

  // A clause that goes on starts with its verb if it can; else the verb's place, verb first
  // (imperative, question), or the tapped word: the first that reads as a verb.
  const tries: { i: number; bare: boolean }[] = [];
  const inPlace = head.includes(place) && isLower(text(place));
  if (verbFirst && !sentenceStart) tries.push({ i: seg[0], bare: false });
  if (inPlace) tries.push({ i: place, bare: false });
  if (verbFirst && sentenceStart) tries.push({ i: seg[0], bare: true });
  if (head.includes(t) && isLower(text(t))) tries.push({ i: t, bare: false });
  for (const { i, bare } of tries) {
    if (!verbLike(i)) continue;
    // A strong verb here is the clause's verb: nothing to build.
    if (isIrregular(word(i))) return null;
    const infinitive = infinitiveOf(word(i), bare);
    if (!infinitive) continue;
    const pronoun = reflexiveAfter(tokens, seg, seg.indexOf(i));
    if (t !== i && t !== particle && t !== pronoun) return null;
    const term = word(particle) + infinitive;
    return pronoun === undefined ? { verb: i, particle, term } : { verb: i, particle, pronoun, term: withSich(term) };
  }
  return null;
}
