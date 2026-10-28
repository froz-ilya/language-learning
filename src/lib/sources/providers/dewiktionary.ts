import type { Pos } from '../../types';
import type { ParsedTerm } from '../../german/parseTerm';
import { compoundHeads, compoundPlural } from '../../german/articles';
import {
  existingTitles,
  fetchWikitext,
  fetchWikitexts,
  MAX_TITLES,
  parseEntry,
  prefixSearch,
  type WikiEntry,
} from '../../lookup/wiktionary';
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

/**
 * Where page texts come from: one request per page (single lookups), or a loader that batches
 * the pages many words need (fillCards). The parsing below is the same for both.
 */
export interface WikiSource {
  /** Raw wikitext of a page (redirects followed), null if it doesn't exist. */
  wikitext(title: string, signal?: AbortSignal): Promise<string | null>;
  /** Which of the titles exist. */
  existing(titles: string[], signal?: AbortSignal): Promise<Set<string>>;
}

/** One request per page. */
export const directSource: WikiSource = { wikitext: fetchWikitext, existing: existingTitles };

/** First German entry among the spelling variants a user may have meant ("haus" → "Haus"). */
async function findEntry(parsed: ParsedTerm, src: WikiSource, signal?: AbortSignal): Promise<WikiEntry | null> {
  const t = parsed.term;
  const variants =
    parsed.pos === 'noun' ? unique([capitalise(t), t, t.toLowerCase()]) : unique([t, capitalise(t), t.toLowerCase()]);
  for (const v of variants) {
    const wikitext = await src.wikitext(v, signal);
    if (wikitext === null) continue;
    const entry = parseEntry(v, wikitext);
    if (entry) return entry;
  }
  return null;
}

/** Gender and plural of an unknown compound from its longest known head noun. */
async function findCompound(word: string, src: WikiSource, signal?: AbortSignal): Promise<WikiDetails | null> {
  const heads = compoundHeads(word)
    .filter((h) => word.length - h.length >= MIN_COMPOUND_PREFIX)
    .slice(0, MAX_TITLES);
  if (!heads.length) return null;
  const existing = await src.existing(heads, signal);
  let fetched = 0;
  for (const head of heads) {
    if (!existing.has(head)) continue;
    if (fetched++ >= MAX_HEAD_FETCHES) break;
    const wikitext = await src.wikitext(head, signal);
    const entry = wikitext === null ? null : parseEntry(head, wikitext);
    if (!entry || entry.pos !== 'noun' || !entry.genders.length) continue;
    return { kind: 'compound', word, pos: 'noun', head: entry, plural: compoundPlural(word, head, entry.plural) };
  }
  return null;
}

/**
 * Word details from de.wiktionary pages: entry for the typed word (spelling variants),
 * inflected form → lemma, else the compound-noun fallback. Null when nothing was found.
 */
export async function wikiDetails(parsed: ParsedTerm, src: WikiSource, signal?: AbortSignal): Promise<WikiDetails | null> {
  const term = parsed.term;
  let entry = await findEntry(parsed, src, signal);
  let lemmaOf: string | undefined;
  let inflected = false;

  if (entry?.lemma && entry.lemma !== entry.title) {
    inflected = true;
    const wikitext = await src.wikitext(entry.lemma, signal);
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
  if (!inflected && looksLikeNoun && /^\p{L}+$/u.test(term)) return findCompound(capitalise(term), src, signal);
  return null;
}

/** Entry of an exact lemma's page (null for a missing page or an inflected form's page). */
export async function lemmaEntry(title: string, src: WikiSource, signal?: AbortSignal): Promise<WikiEntry | null> {
  const wikitext = await src.wikitext(title, signal);
  const entry = wikitext === null ? null : parseEntry(title, wikitext);
  return entry && !entry.lemma ? entry : null;
}

/** de.wiktionary word details (see wikiDetails). Several requests, hence the longer timeout. */
export const deWiktionaryDetails: Provider<ParsedTerm, WikiDetails> = {
  id: 'de.wiktionary',
  timeoutMs: 8000,
  run: (parsed, signal) => wikiDetails(parsed, directSource, signal),
};

/** de.wiktionary entry for an exact lemma (used to add examples to an offline-dictionary hit). */
export const deWiktionaryEntry: Provider<string, WikiEntry> = {
  id: 'de.wiktionary',
  run: (title, signal) => lemmaEntry(title, directSource, signal),
};

/** Pages many words need at once (fillCards): wikitext of some titles, existence of others. */
export interface PageQuery {
  content: string[];
  exist: string[];
}

export interface PageAnswer {
  /** Wikitext by requested title (null: no such page); titles the API sent nothing for are absent. */
  content: Map<string, string | null>;
  /** Titles of `exist` that exist. */
  existing: Set<string>;
}

/** de.wiktionary pages in batches: 50 titles per request (see fetchWikitexts). */
export const deWiktionaryPages: Provider<PageQuery, PageAnswer> = {
  id: 'de.wiktionary',
  timeoutMs: 30_000,
  async run({ content, exist }, signal) {
    const pages = content.length ? await fetchWikitexts(content, signal) : new Map<string, string | null>();
    const existing = new Set<string>();
    for (let i = 0; i < exist.length; i += MAX_TITLES) {
      for (const t of await existingTitles(exist.slice(i, i + MAX_TITLES), signal)) existing.add(t);
    }
    return { content: pages, existing };
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
