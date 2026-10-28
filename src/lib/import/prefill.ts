// Instant offline fill at import: each pasted row gets the offline dictionary's grammar
// (part of speech, article, plural, verb forms) before it is saved, so the new set opens
// complete without waiting for online sources. Online auto-fill (examples, missing bits)
// runs afterwards in the background (src/lib/fill/runner.svelte.ts).
import type { Card, Lang } from '../types';
import type { LexEntry, LocalHit } from '../dict/types';
import { lookupLocal } from '../dict/local';
import { emptyCard } from '../db/repo';
import type { ImportRow } from './parse';

/** Card fields for one row, plus a hint when the term looks like an inflected form. */
export interface Prefill {
  fields: Pick<Card, 'term' | 'translation' | 'pos' | 'genders' | 'plural' | 'praeteritum' | 'partizip2' | 'auxiliary'>;
  /** Dictionary lemma when the typed term is an inflected form of it ("wundert" → "wundern"). */
  lemma?: string;
  /** Something came from the dictionary. */
  fromDict: boolean;
}

export type LookupFn = (word: string) => Promise<LocalHit[]>;

/** Rows looked up at a time (dictionary pieces are cached after the first load). */
const BATCH = 64;

/**
 * The word to look up for a term, and whether only a verb lemma may match: "sich streiten" →
 * streiten, "lachen über" → lachen (the infinitive before a preposition). Other phrases
 * ("wird in … gedreht") are not looked up.
 */
function lookupWord(term: string): { word: string; verbOnly: boolean } | null {
  const t = term.replace(/^sich\s+/i, '');
  if (!/\s/.test(t)) return { word: t, verbOnly: t !== term };
  const [first, ...rest] = t.split(/\s+/);
  if (rest.length === 1 && /^\p{Ll}+(?:en|ern|eln)$/u.test(first) && /^\p{Ll}+$/u.test(rest[0])) return { word: first, verbOnly: true };
  return null;
}

/** Same word ignoring case (the dictionary's "Rede" for a typed "rede"). */
const sameTerm = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Partizip I ("aufregen" → aufregend) or Partizip II ("verlieben" → verliebt) of a verb. */
function isParticiple(word: string, e: LexEntry): boolean {
  if (e.pos !== 'verb') return false;
  return sameTerm(word, `${e.term}d`) || (!!e.partizip2 && sameTerm(word, e.partizip2));
}

/**
 * Pick the dictionary entry for a row: a lemma that is the term itself (exact case first), of
 * the typed part of speech, with the typed article when there is one ("die See" → die See, not
 * der See). Inflected-form hits are never used for fields, only as a hint.
 */
function pick(row: ImportRow, word: string, verbOnly: boolean, hits: LocalHit[]): { entry: LexEntry | null; lemma?: string } {
  const p = row.parsed;
  const pos = verbOnly ? 'verb' : p.pos;
  const lemmas = hits.filter((h) => !h.form && sameTerm(h.entry.term, word) && (!pos || h.entry.pos === pos)).map((h) => h.entry);
  if (!lemmas.length) {
    // "wundert" → wundern: keep what was typed, just offer the lemma. Participles are words of
    // their own in word lists ("aufregend", "verliebt"), so they get no hint.
    const form = hits.find((h) => h.form && !sameTerm(h.entry.term, word) && !isParticiple(word, h.entry));
    return { entry: null, lemma: !verbOnly && form && !/\s/.test(p.term) ? form.entry.term : undefined };
  }
  const exact = lemmas.filter((e) => e.term === word);
  const list = exact.length ? exact : lemmas;
  if (p.genders.length) {
    const match = list.find((e) => e.genders.some((g) => p.genders.includes(g)));
    if (match) return { entry: match };
  }
  return { entry: list[0] };
}

/**
 * Card fields for a pasted row: what the user typed always wins (article, plural, verb forms,
 * translation); the dictionary only fills fields left empty. The term stays as typed.
 */
export function prefillFromEntry(row: ImportRow, entry: LexEntry | null, lang: Lang): Prefill['fields'] {
  const p = row.parsed;
  const e = entry;
  const pos = p.pos ?? e?.pos ?? 'other';
  return {
    term: p.term,
    translation: row.translation.trim() || e?.tr[lang] || '',
    pos,
    genders: p.genders.length ? [...p.genders] : pos === 'noun' && e?.pos === 'noun' ? [...e.genders] : [],
    plural: p.plural || (pos === 'noun' && e?.pos === 'noun' ? e.plural : ''),
    praeteritum: p.praeteritum || (pos === 'verb' && e?.pos === 'verb' ? e.praeteritum : ''),
    partizip2: p.partizip2 || (pos === 'verb' && e?.pos === 'verb' ? e.partizip2 : ''),
    auxiliary: p.auxiliary || (pos === 'verb' && e?.pos === 'verb' ? e.auxiliary : ''),
  };
}

export async function prefillRow(row: ImportRow, lang: Lang, lookup: LookupFn = lookupLocal): Promise<Prefill> {
  const target = lookupWord(row.parsed.term);
  let hits: LocalHit[] = [];
  if (target) {
    try {
      hits = await lookup(target.word);
    } catch {
      hits = []; // dictionary unavailable: the row is saved as typed
    }
  }
  const { entry, lemma } = target ? pick(row, target.word, target.verbOnly, hits) : { entry: null };
  const out: Prefill = { fields: prefillFromEntry(row, entry, lang), fromDict: !!entry };
  if (lemma) out.lemma = lemma;
  return out;
}

/** prefillRow for many rows, looked up in parallel batches; results in row order. */
export async function prefillRows(rows: ImportRow[], lang: Lang, lookup: LookupFn = lookupLocal): Promise<Prefill[]> {
  const out: Prefill[] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    out.push(...(await Promise.all(rows.slice(i, i + BATCH).map((r) => prefillRow(r, lang, lookup)))));
  }
  return out;
}

/** Grammar the online sources could still add: articles for nouns, forms for verbs. */
function grammarMissing(f: Prefill['fields']): boolean {
  if (f.pos === 'other') return true;
  if (f.pos === 'noun') return !f.genders.length || !f.plural;
  if (f.pos === 'verb') return !f.praeteritum || !f.partizip2 || !f.auxiliary;
  return false;
}

/**
 * Worth an online fill: examples are always missing at import, so with auto-fill on every
 * card qualifies; grammar and translation are listed for clarity (and future callers).
 */
export function wantsOnlineFill(card: Pick<Card, 'examples'> & Prefill['fields']): boolean {
  return !card.examples.some((e) => e.de.trim()) || grammarMissing(card) || !card.translation.trim();
}

/** The cards to save for pasted rows, in pasted order. */
export function importCards(setId: number, prefills: Prefill[], autoFill: boolean, now = Date.now()): Card[] {
  return prefills.map((pf, i) => {
    const card: Card = {
      ...emptyCard(setId),
      ...pf.fields,
      genders: [...pf.fields.genders],
      createdAt: now + i, // keep the pasted order
    };
    card.needsFill = autoFill && wantsOnlineFill(card) ? 1 : 0;
    return card;
  });
}
