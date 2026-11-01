// Everything shown about one German word: offline dictionary first, the online lookup only when
// the offline entry is missing or untranslated, merged into card fields. Shared by the reader's
// word sheet (components/reading/WordSheet.svelte) and the quick search (routes/Search.svelte).
import { articleVariants, lookupLocal } from '../dict/local';
import type { LexEntry, LocalHit } from '../dict/types';
import { lookupWord } from '../lookup/lookup';
import { ARTICLE, displayPlural, displayTerm, displayVerbForms } from '../german/articles';
import { splitMeanings } from '../german/meanings';
import { asReflexive, baseOfReflexive, isReflexiveTerm, withSich } from '../german/reflexive';
import { fieldsFromEntry, fieldsFromLookup } from '../reading/store';
import type { ArticleVariant, Auxiliary, Card, Gender, Lang, LookupResult, Pos } from '../types';

export type RemoteState = 'idle' | 'loading' | 'done' | 'failed';

/** Card fields known about a word (always with a term). */
export type WordFields = Partial<Card> & { term: string };

export interface WordLookupState {
  /** Best offline entry (or the caller's precomputed one). */
  local: LexEntry | null;
  /** Every article of a noun whose articles differ in meaning (der See, die See); else [local]. */
  localArticles: LexEntry[];
  localDone: boolean;
  /** The input as written when it was an inflected form of `local` ("Gehälter" for Gehalt); ''. */
  form: string;
  /**
   * The word's dictionary readings for wordReadings: the one in `local` first, then the other
   * words spelled like it (sein: the verb, the possessive, das Sein). Inflected forms of other
   * words don't count ("treffen" is also a form of eintreffen). For "sich treffen": the plain verb.
   * A word only the lookup knows gets one entry made from it.
   */
  readings: LexEntry[];
  remote: LookupResult | null;
  remoteState: RemoteState;
}

export function initialWordLookup(): WordLookupState {
  return { local: null, localArticles: [], localDone: false, form: '', readings: [], remote: null, remoteState: 'idle' };
}

/**
 * A "sich …" entry of a verb the dictionary doesn't know as reflexive (no `reflexive` flag): its
 * translation is just the plain verb's (asReflexive falls back to it), so the lookup is asked.
 * A flagged verb without trRefl has reflexive meanings the same as its translations.
 */
export const weakReflexive = (e: LexEntry | null): boolean => !!e && isReflexiveTerm(e.term) && !e.reflexive;

/**
 * The online lookup is needed when the offline entry is missing or has no translation (any
 * article), or is a "sich …" verb with only the plain verb's translation.
 */
export function needsRemote(best: LexEntry | null, variants: LexEntry[], lang: Lang): boolean {
  const untranslated = variants.length > 1 ? variants.some((v) => !v.tr[lang]) : !best?.tr[lang];
  return !best || untranslated || weakReflexive(best);
}

/**
 * Card fields from an offline entry, with a term (prepositions as fieldsFromEntry gives them: not
 * on the plain verb of a verb that is also reflexive, they belong to its "sich …" reading).
 */
export const entryFields = (entry: LexEntry, lang: Lang): WordFields => ({ ...fieldsFromEntry(entry, lang), term: entry.term });

/** "auf + Akk; über + Akk" → "auf + Akk · über + Akk" (for the line under the forms). */
export const prepsText = (preps: string | undefined): string =>
  (preps ?? '')
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' · ');

const sameEntry = (a: LexEntry, b: LexEntry) => a.term === b.term && a.pos === b.pos && a.genders.join() === b.genders.join();

/** The reading to open on: the caller's entry (a tapped result row), a noun of the wanted article, else the best. */
function bestHit(hits: LocalHit[], entry: LexEntry | null | undefined, want: Gender | null | undefined): LocalHit | undefined {
  return (
    (entry ? hits.find((h) => sameEntry(h.entry, entry)) : undefined) ??
    (want ? hits.find((h) => h.entry.pos === 'noun' && h.entry.genders.includes(want)) : undefined) ??
    hits[0]
  );
}

/** What to ask the lookup for one reading: a noun with its article ("das Laufen", not the verb laufen). */
const askFor = (e: LexEntry): string => (e.pos === 'noun' && e.genders.length === 1 ? `${ARTICLE[e.genders[0]]} ${e.term}` : e.term);

/** The lookup found another word spelled the same (asked for "sein", the possessive; got the verb). */
const otherWord = (r: LookupResult, e: LexEntry): boolean => r.pos !== 'other' && r.pos !== e.pos;

/** A word only the lookup knows, as an entry for `readings`. */
function entryFromLookup(r: LookupResult, lang: Lang): LexEntry {
  const { term, pos, genders, plural, praeteritum, partizip2, auxiliary } = r;
  return { term, pos, genders, plural, praeteritum, partizip2, auxiliary, tr: { ru: '', en: '', [lang]: r.translation }, rank: 0 };
}

/**
 * Look `word` up: offline dictionary (lemma, article variants), then — only if needed and
 * online — the online lookup. `onchange` gets a fresh state after each step; nothing is
 * reported once `signal` is aborted. Never throws.
 */
export async function loadWordInfo(
  word: string,
  opts: {
    /** Precomputed lemma (the reader's map); opened on when it's one of the hits, used when there are none. */
    entry?: LexEntry | null;
    /** `entry` is the reading to show, whatever else `word` may be: the dictionary isn't asked for another. */
    fixed?: boolean;
    /** Article to prefer among the hits ("das Sein" next to the verb sein). */
    want?: Gender | null;
    lang: Lang;
    isOnline: () => boolean;
    signal: AbortSignal;
    onchange?: (s: WordLookupState) => void;
  },
): Promise<WordLookupState> {
  const { lang, signal } = opts;
  const state = initialWordLookup();
  const emit = () => {
    if (!signal.aborted) opts.onchange?.({ ...state });
  };
  let best: LexEntry | null = opts.entry ?? null;
  const fixed = !!opts.fixed && !!best;
  let variants: LexEntry[] = [];
  let readings: LexEntry[] = best ? [best] : [];
  let form = '';
  try {
    if (!fixed) {
      const hits = await lookupLocal(word);
      const hit = bestHit(hits, opts.entry, opts.want);
      best = hit?.entry ?? opts.entry ?? null;
      form = hit?.form ?? '';
      readings = [...new Set([...(best ? [best] : []), ...hits.filter((h) => !h.form).map((h) => h.entry)])];
      if (isReflexiveTerm(word)) {
        const verb = (await lookupLocal(baseOfReflexive(word))).find((h) => h.entry.pos === 'verb')?.entry;
        // "sich treffen" where the dictionary has no "sich …" terms: the verb, read reflexively.
        if (!(best && isReflexiveTerm(best.term))) {
          if (verb) best = asReflexive(verb);
          form = '';
        }
        if (verb) readings = [verb];
      }
    }
    // A verb used only with "sich" is shown and added as "sich beeilen".
    if (best?.reflexive === 'only') best = asReflexive(best);
    if (best) variants = await articleVariants(best);
  } catch {
    // keep the precomputed entry
  }
  if (signal.aborted) return state;
  state.local = best;
  state.localArticles = variants;
  state.localDone = true;
  state.form = form;
  state.readings = readings;
  const remote = needsRemote(best, variants, lang) && opts.isOnline();
  if (remote) state.remoteState = 'loading';
  emit();
  if (!remote) return state;
  try {
    const reading = fixed ? best : null;
    const found = await lookupWord(reading ? askFor(reading) : (best?.term ?? word), lang, signal);
    state.remote = found && reading && otherWord(found, reading) ? null : found;
    if (!best && state.remote) state.readings = [entryFromLookup(state.remote, lang)];
    state.remoteState = 'done';
  } catch {
    state.remoteState = 'failed';
  }
  emit();
  return state;
}

/**
 * The lookup as the reading `local` stands for: for a "sich …" entry whose lookup came back as
 * the plain verb with a reflexive reading (treffen + reflexive), that reading as "sich treffen".
 */
export function remoteFor(local: LexEntry | null, remote: LookupResult | null): LookupResult | null {
  if (!remote?.reflexive || !local || !isReflexiveTerm(local.term) || isReflexiveTerm(remote.term)) return remote;
  const r = remote.reflexive;
  const out: LookupResult = { ...remote, term: withSich(remote.term), translation: r.translation, examples: r.examples };
  delete out.reflexive;
  delete out.phrases;
  delete out.preps;
  if (r.meaningExamples) out.meaningExamples = r.meaningExamples;
  else delete out.meaningExamples;
  if (r.preps) out.preps = r.preps;
  return out;
}

/** Everything known about the word, local entry first, gaps filled from the online lookup. */
export function mergeInfo(local: LexEntry | null, remoteResult: LookupResult | null, lang: Lang): WordFields | null {
  const remote = remoteFor(local, remoteResult);
  const base = local ? fieldsFromEntry(local, lang) : null;
  const extra = remote ? fieldsFromLookup(remote) : null;
  const preps = base?.preps || extra?.preps;
  const withPreps = (f: WordFields): WordFields => (preps ? { ...f, preps } : f);
  if (!base && !extra) return null;
  if (!base) return withPreps({ ...extra!, term: extra!.term! });
  if (!extra) return withPreps({ ...base, term: base.term! });
  // The lookup's "sich …" reading of a verb the dictionary has without it (sich beeilen), and
  // its reflexive translation over the plain verb's one asReflexive() fell back to.
  const reflexiveRemote = isReflexiveTerm(extra.term!) && baseOfReflexive(extra.term!) === baseOfReflexive(base.term!);
  const preferRemote = reflexiveRemote && !!extra.translation && weakReflexive(local);
  return withPreps({
    ...base,
    term: reflexiveRemote ? extra.term! : base.term!,
    translation: preferRemote ? extra.translation : base.translation || extra.translation,
    genders: base.genders?.length ? base.genders : extra.genders,
    plural: base.plural || extra.plural,
    examples: extra.examples,
  });
}

/**
 * The reflexive reading of a plain verb (treffen → "sich treffen" — встречаться), from the
 * dictionary's flags or the lookup's `reflexive`, as card fields; null when it has none (or the
 * word already is the "sich …" reading). The translation is the dictionary's (asReflexive), else
 * the lookup's, else ''.
 */
export function reflexiveReadingOf(local: LexEntry | null, remote: LookupResult | null, lang: Lang): WordFields | null {
  if (local && (local.pos !== 'verb' || isReflexiveTerm(local.term))) return null;
  const sameWord = !!remote && !isReflexiveTerm(remote.term) && (!local || remote.term === local.term);
  const r = sameWord ? remote!.reflexive : undefined;
  if (local?.reflexive !== 'also' && !r) return null;
  const plain = local ? fieldsFromEntry(local, lang) : fieldsFromLookup(remote!);
  const out: WordFields = {
    ...plain,
    term: withSich(local?.term ?? remote!.term),
    translation: (local?.reflexive ? asReflexive(local).tr[lang] : '') || r?.translation || '',
    examples: (r?.examples ?? []).map((e) => ({ ...e })),
  };
  // The plain reading's prepositions don't carry over; the dictionary's are the "sich …" ones.
  delete out.preps;
  const preps = r?.preps || local?.preps;
  if (preps) out.preps = preps;
  return out;
}

/** One way to read a word, as an option of the switcher (components/ReadingSwitch.svelte). */
export interface WordReading {
  /** Stable while the word is shown (see readingId). */
  id: string;
  term: string;
  pos: Pos;
  /** Short and distinct among the word's readings: "treffen", "sich treffen", "das Treffen", "sein (verb)". */
  label: string;
  /** Dictionary entry to show, as read in this reading; null when only the lookup knows it (look up `term`). */
  entry: LexEntry | null;
}

/** All articles of a noun are one reading: its article rows choose between them. */
export const readingId = (w: Pick<LexEntry, 'term' | 'pos'>): string => `${w.term}|${w.pos}`;

/** The id of the reading a lookup opened on (`local`, or its plain verb when there is none). */
export function openingReadingId(s: WordLookupState): string {
  const e = s.local ?? s.readings[0];
  return e ? readingId(e) : '';
}

/** The dictionary files pronouns, adverbs and more under 'other': named by the first meaning, unless listed here. */
const OTHER_POS: Record<string, string> = { sein: 'possessive' };

function posWord(pos: Pos, term: string, translation: string): string {
  if (pos === 'verb') return 'verb';
  if (pos === 'noun') return 'noun';
  if (pos === 'adj') return 'adjective';
  return OTHER_POS[term.toLowerCase()] ?? splitMeanings(translation)[0]?.[0] ?? 'other';
}

/**
 * The options of a word's switcher, from its dictionary entries, best first: each entry, a verb's
 * "sich …" reading right after it (from the dictionary, or from `remotes`: lookups answered so
 * far). The articles of a noun stay one option. Labels are the word with its article; only
 * readings that would look the same get a part of speech ("sein (verb)", "sein (possessive)").
 * Fewer than 2 means there's nothing to switch.
 */
export function wordReadings(entries: LexEntry[], lang: Lang, remotes: LookupResult[] = []): WordReading[] {
  type Draft = Omit<WordReading, 'label'> & { genders: Gender[]; translation: string };
  const drafts: Draft[] = [];
  const add = (d: Omit<Draft, 'id'>) => {
    const id = readingId(d);
    const same = drafts.find((x) => x.id === id);
    if (same) same.genders.push(...d.genders.filter((g) => !same.genders.includes(g)));
    else drafts.push({ ...d, id });
  };
  for (const raw of entries) {
    const e = raw.reflexive === 'only' ? asReflexive(raw) : raw;
    add({ term: e.term, pos: e.pos, entry: e, genders: [...e.genders], translation: e.tr[lang] || e.tr.en });
    const remote = remotes.find((r) => r.term === e.term && r.reflexive) ?? null;
    const refl = reflexiveReadingOf(e, remote, lang);
    if (!refl) continue;
    add({
      term: refl.term,
      pos: 'verb',
      // A verb the dictionary doesn't know as reflexive is looked up as "sich …" from scratch.
      entry: e.reflexive ? asReflexive(e) : null,
      genders: [],
      translation: '',
    });
  }
  return drafts.map(({ id, term, pos, genders, entry, translation }) => {
    const name = displayTerm({ term, pos, genders });
    const alike = drafts.filter((d) => displayTerm(d).toLowerCase() === name.toLowerCase()).length > 1;
    return { id, term, pos, label: alike ? `${name} (${posWord(pos, term, translation)})` : name, entry };
  });
}

/** More than one reading is spelled `term` (sein, das Sein): their cards are told apart by part of speech. */
export const hasHomographs = (readings: WordReading[], term: string): boolean =>
  readings.filter((r) => r.term.toLowerCase() === term.toLowerCase()).length > 1;

/** A card of such a word is this reading's: same part of speech; a card without one ('other') counts as any. */
export const cardIsReading = (cardPos: Pos | undefined, pos: Pos): boolean => !cardPos || cardPos === 'other' || cardPos === pos;

/** The fields a word's header and forms line need (defaults filled in). */
export interface WordDisplay {
  term: string;
  pos: Pos;
  genders: Card['genders'];
  plural: string;
  praeteritum: string;
  partizip2: string;
  auxiliary: Auxiliary;
}

export function displayOf(info: WordFields | null): WordDisplay | null {
  if (!info) return null;
  return {
    term: info.term,
    pos: info.pos ?? 'other',
    genders: info.genders ?? [],
    plural: info.plural ?? '',
    praeteritum: info.praeteritum ?? '',
    partizip2: info.partizip2 ?? '',
    auxiliary: info.auxiliary ?? '',
  };
}

/** "die Häuser" for a noun, "ging – ist gegangen" for a verb, else ''. */
export function formsOf(display: WordDisplay | null): string {
  if (!display) return '';
  if (display.pos === 'noun') return displayPlural(display);
  if (display.pos === 'verb') return displayVerbForms(display);
  return '';
}

/**
 * A noun whose articles differ in meaning: one row per article ("der See — озеро",
 * "die See — море"), each added as its own card. Offline entries first, gaps from the lookup.
 * [] (or fewer than 2) for any other word.
 */
export function articleRowsOf(
  local: LexEntry | null,
  localArticles: LexEntry[],
  remote: LookupResult | null,
  lang: Lang,
): ArticleVariant[] {
  const online = remote?.term === local?.term || !local ? (remote?.articles ?? []) : [];
  if (localArticles.length > 1) {
    return localArticles.map((e) => {
      const r = online.find((a) => a.genders[0] === e.genders[0]);
      return {
        genders: [...e.genders],
        plural: e.plural || r?.plural || '',
        translation: e.tr[lang] || r?.translation || '',
        examples: r?.examples ?? [],
      };
    });
  }
  return online;
}

/** Card fields for one article of such a noun ("die See"). */
export function articleCardFields(term: string, a: ArticleVariant): WordFields {
  return {
    term,
    pos: 'noun',
    genders: [a.genders[0]],
    plural: a.plural,
    translation: a.translation,
    examples: a.examples.map((e) => ({ ...e })),
  };
}
