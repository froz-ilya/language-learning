// Results of the quick search. Latin input: German words (the typed word or a word it is a
// form of, then words starting with it), and below them German words found by an English
// translation. Cyrillic input: German words found by a Russian translation. Rows are always
// German words.
import { lookupLocal } from '../dict/local';
import type { LexEntry, LocalHit } from '../dict/types';
import { queryScript, reverseSearch, type ReverseHit } from '../dict/reverse';
import { suggest, type Suggestion } from '../lookup/lookup';
import { previewOf } from '../lookup/meanings';
import { articleOf } from '../german/articles';
import { parseGermanInput } from '../german/parseTerm';
import type { Gender, Lang, Pos } from '../types';
import { isSameWord } from './addToSet';

export interface SearchRow {
  /** Unique within its group. */
  key: string;
  term: string;
  pos: Pos;
  genders: Gender[];
  /** Translation preview (German rows) or the translation that matched (reverse rows). */
  hint: string;
  /** The typed word when it is an inflected form of this one ("ging" for gehen). */
  form?: string;
  /** Article to select when the row is opened (one article of a noun). */
  gender?: Gender;
  /** Offline dictionary entry, when known. */
  entry?: LexEntry;
}

export interface SearchGroups {
  german: SearchRow[];
  /** "From English": German words whose English translation matches (Latin input). */
  english: SearchRow[];
  /** German words whose Russian translation matches (Cyrillic input). */
  russian: SearchRow[];
}

export const MAX_GERMAN = 10;
export const MAX_ENGLISH = 8;
export const MAX_RUSSIAN = 15;
/** Shorter queries show recent searches instead. */
export const MIN_QUERY = 2;

export const emptyGroups = (): SearchGroups => ({ german: [], english: [], russian: [] });

/** "das Haus", "der/das Teil", "gehen": how a row is named (and stored in recent searches). */
export function rowLabel(row: Pick<SearchRow, 'term' | 'pos' | 'genders' | 'gender'>): string {
  const genders = row.gender ? [row.gender] : row.genders;
  return row.pos === 'noun' && genders.length ? `${articleOf(genders)} ${row.term}` : row.term;
}

function rowOfEntry(entry: LexEntry, hint: string, extra: Partial<SearchRow> = {}): SearchRow {
  const genders = entry.pos === 'noun' ? [...entry.genders] : [];
  const row: SearchRow = { key: '', term: entry.term, pos: entry.pos, genders, hint, entry, ...extra };
  if (genders.length === 1 && !row.gender) row.gender = genders[0];
  return row;
}

/** Rows for the word typed itself: its lemma(s), or the lemma(s) it is a form of. */
export function exactRows(hits: LocalHit[], lang: Lang): SearchRow[] {
  return hits.map((h) => rowOfEntry(h.entry, previewOf(h.entry.tr[lang]), h.form ? { form: h.form } : {}));
}

/**
 * Rows for prefix suggestions. `entries` holds the offline entry of a suggestion where there
 * is one (same index), so rows show their article; online suggestions have none.
 */
export function suggestionRows(list: Suggestion[], entries: (LexEntry | null)[], lang: Lang): SearchRow[] {
  return list.map((s, i) => {
    const e = entries[i];
    const gender = s.genders?.[0];
    if (e) return rowOfEntry(e, s.preview || previewOf(e.tr[lang]), gender ? { gender, genders: [gender] } : {});
    return { key: '', term: s.word, pos: s.genders ? 'noun' : 'other', genders: s.genders ? [...s.genders] : [], hint: s.preview ?? '', gender };
  });
}

/** Rows for reverse-search hits (one per dictionary id). */
export function reverseRows(hits: ReverseHit[]): SearchRow[] {
  const seen = new Set<string>();
  const out: SearchRow[] = [];
  for (const h of hits) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    out.push({ ...rowOfEntry(h.entry, h.translation), key: h.id });
  }
  return out;
}

const keyOf = (r: SearchRow) => `${r.term}|${(r.gender ? [r.gender] : r.genders).join('')}`;
/** Same word and article. Case counts here: "sein" (verb) and "das Sein" are two words. */
const sameRow = (a: SearchRow, b: SearchRow) =>
  a.term === b.term && isSameWord({ term: a.term, genders: a.gender ? [a.gender] : a.genders }, b.term, b.gender ? [b.gender] : b.genders);

/** Drop rows already listed (same word, same article), keep the first. */
function dedupe(rows: SearchRow[], shown: SearchRow[] = []): SearchRow[] {
  const out: SearchRow[] = [];
  for (const r of rows) {
    if (shown.some((s) => sameRow(s, r)) || out.some((s) => sameRow(s, r))) continue;
    out.push({ ...r, key: r.key || keyOf(r) });
  }
  return out;
}

/**
 * Put the results of a Latin query together: the typed word first, then suggestions, without
 * repeats; a typed article ("die See") puts that article first and selects it. "From English"
 * leaves out words already shown as German results.
 */
export function buildGroups(input: {
  query: string;
  exact: SearchRow[];
  suggested: SearchRow[];
  english: SearchRow[];
}): SearchGroups {
  const typed = parseGermanInput(input.query).genders;
  let german = dedupe([...input.exact, ...input.suggested]);
  // Online suggestions (not in the offline dictionary) for a query that is an English word
  // ("house" → housewife, houseboat) are English words, not German: leave them out.
  if (input.english.length) german = german.filter((r) => r.entry);
  if (typed.length) {
    const want = parseGermanInput(input.query).term.toLowerCase();
    const startsLike = (r: SearchRow) => r.term.toLowerCase().startsWith(want);
    const matches = (r: SearchRow) => startsLike(r) && (r.gender ? typed.includes(r.gender) : r.genders.some((g) => typed.includes(g)));
    german = [...german.filter(matches), ...german.filter((r) => !matches(r))].map((r) =>
      // The typed word itself without a known article (an online suggestion) takes the typed one.
      r.term.toLowerCase() === want && !r.genders.length && r.pos === 'other' ? { ...r, gender: typed[0] } : r,
    );
  }
  german = german.slice(0, MAX_GERMAN);
  const english = dedupe(input.english, german).slice(0, MAX_ENGLISH);
  return { german, english, russian: [] };
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

/** The offline entry a suggestion stands for (its article's entry for one article of a noun). */
async function entryOfSuggestion(s: Suggestion): Promise<LexEntry | null> {
  const hits = await safe(lookupLocal(s.word), []);
  const same = hits.filter((h) => h.entry.term === s.word && !h.form);
  const g = s.genders?.[0];
  return (g ? same.find((h) => h.entry.genders[0] === g) : undefined)?.entry ?? same[0]?.entry ?? null;
}

/**
 * Search for `query`. `onupdate` gets the groups found so far as each source answers (the
 * offline dictionary first, then suggestions and translations); nothing after `signal` aborts.
 * Never throws.
 */
export async function searchWords(
  query: string,
  lang: Lang,
  signal: AbortSignal,
  onupdate?: (g: SearchGroups) => void,
): Promise<SearchGroups> {
  const q = query.normalize('NFC').trim().replace(/\s+/g, ' ');
  const script = queryScript(q);
  if (q.length < MIN_QUERY || script === 'none') return emptyGroups();

  if (script === 'ru') {
    const hits = await safe(reverseSearch(q, 'ru', MAX_RUSSIAN), []);
    const groups = { ...emptyGroups(), russian: dedupe(reverseRows(hits)) };
    if (!signal.aborted) onupdate?.(groups);
    return groups;
  }

  let exact: SearchRow[] = [];
  let suggested: SearchRow[] = [];
  let english: SearchRow[] = [];
  let groups = emptyGroups();
  const update = () => {
    groups = buildGroups({ query: q, exact, suggested, english });
    if (!signal.aborted) onupdate?.(groups);
  };
  await Promise.all([
    safe(lookupLocal(q), []).then((hits) => {
      exact = exactRows(hits, lang);
      update();
    }),
    safe(suggest(q, lang, signal), [] as Suggestion[]).then(async (list) => {
      const entries = await Promise.all(list.map(entryOfSuggestion));
      suggested = suggestionRows(list, entries, lang);
      update();
    }),
    safe(reverseSearch(q, 'en', MAX_ENGLISH + 4), []).then((hits) => {
      english = reverseRows(hits);
      update();
    }),
  ]);
  return groups;
}
