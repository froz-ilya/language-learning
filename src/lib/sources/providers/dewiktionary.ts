import type { Pos } from '../../types';
import type { ParsedTerm } from '../../german/parseTerm';
import { compoundHeads, compoundPlural } from '../../german/articles';
import { existingTitles, fetchWikitext, parseEntry, prefixSearch, type WikiEntry } from '../../lookup/wiktionary';
import type { Provider } from '../chain';

/** At most this many existing head nouns are fetched when guessing a compound's gender. */
const MAX_HEAD_FETCHES = 3;
/** A compound's modifier ("Haus" in "Hausschlüssel") must be at least this long. */
const MIN_COMPOUND_PREFIX = 3;

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const isCapitalised = (s: string) => /^\p{Lu}/u.test(s);
const unique = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

export type WikiDetails =
  /** A dictionary entry; `lemmaOf` is the typed inflected form when it was redirected to its lemma. */
  | { kind: 'entry'; entry: WikiEntry; lemmaOf?: string }
  /** An unknown compound whose gender/plural come from its head noun ("Hausschlüssel" → "Schlüssel"). */
  | { kind: 'compound'; word: string; pos: Pos; head: WikiEntry; plural: string };

/** First German entry among the spelling variants a user may have meant ("haus" → "Haus"). */
async function findEntry(parsed: ParsedTerm, signal?: AbortSignal): Promise<WikiEntry | null> {
  const t = parsed.term;
  const variants =
    parsed.pos === 'noun' ? unique([capitalise(t), t, t.toLowerCase()]) : unique([t, capitalise(t), t.toLowerCase()]);
  for (const v of variants) {
    const wikitext = await fetchWikitext(v, signal);
    if (wikitext === null) continue;
    const entry = parseEntry(v, wikitext);
    if (entry) return entry;
  }
  return null;
}

/** Gender and plural of an unknown compound from its longest known head noun. */
async function findCompound(word: string, signal?: AbortSignal): Promise<WikiDetails | null> {
  const heads = compoundHeads(word).filter((h) => word.length - h.length >= MIN_COMPOUND_PREFIX);
  if (!heads.length) return null;
  const existing = await existingTitles(heads, signal);
  let fetched = 0;
  for (const head of heads) {
    if (!existing.has(head)) continue;
    if (fetched++ >= MAX_HEAD_FETCHES) break;
    const wikitext = await fetchWikitext(head, signal);
    const entry = wikitext === null ? null : parseEntry(head, wikitext);
    if (!entry || entry.pos !== 'noun' || !entry.genders.length) continue;
    return { kind: 'compound', word, pos: 'noun', head: entry, plural: compoundPlural(word, head, entry.plural) };
  }
  return null;
}

/**
 * de.wiktionary word details: entry for the typed word (spelling variants), inflected form →
 * lemma, else the compound-noun fallback. Several requests, hence the longer timeout.
 */
export const deWiktionaryDetails: Provider<ParsedTerm, WikiDetails> = {
  id: 'de.wiktionary',
  timeoutMs: 8000,
  async run(parsed, signal) {
    const term = parsed.term;
    let entry = await findEntry(parsed, signal);
    let lemmaOf: string | undefined;
    let inflected = false;

    if (entry?.lemma && entry.lemma !== entry.title) {
      inflected = true;
      const wikitext = await fetchWikitext(entry.lemma, signal);
      const lemmaEntry = wikitext === null ? null : parseEntry(entry.lemma, wikitext);
      if (lemmaEntry && !lemmaEntry.lemma) {
        entry = lemmaEntry;
        lemmaOf = term;
      } else {
        entry = null;
      }
    }
    if (entry) return lemmaOf ? { kind: 'entry', entry, lemmaOf } : { kind: 'entry', entry };

    const looksLikeNoun = parsed.pos === 'noun' || isCapitalised(term) || term.length >= 6;
    if (!inflected && looksLikeNoun && /^\p{L}+$/u.test(term)) return findCompound(capitalise(term), signal);
    return null;
  },
};

/** de.wiktionary entry for an exact lemma (used to add examples to an offline-dictionary hit). */
export const deWiktionaryEntry: Provider<string, WikiEntry> = {
  id: 'de.wiktionary',
  async run(title, signal) {
    const wikitext = await fetchWikitext(title, signal);
    const entry = wikitext === null ? null : parseEntry(title, wikitext);
    return entry && !entry.lemma ? entry : null;
  },
};

/** de.wiktionary prefix search (opensearch). */
export const deWiktionaryPrefix: Provider<{ prefix: string; limit: number }, string[]> = {
  id: 'de.wiktionary',
  async run({ prefix, limit }, signal) {
    const words = await prefixSearch(prefix, limit, signal);
    return words.length ? words : null;
  },
};
