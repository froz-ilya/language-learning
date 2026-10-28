// Everything shown about one German word: offline dictionary first, the online lookup only when
// the offline entry is missing or untranslated, merged into card fields. Shared by the reader's
// word sheet (components/reading/WordSheet.svelte) and the quick search (routes/Search.svelte).
import { articleVariants, lookupLocal } from '../dict/local';
import type { LexEntry } from '../dict/types';
import { lookupWord } from '../lookup/lookup';
import { displayPlural, displayVerbForms } from '../german/articles';
import { fieldsFromEntry, fieldsFromLookup } from '../reading/store';
import type { ArticleVariant, Auxiliary, Card, Lang, LookupResult, Pos } from '../types';

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
  remote: LookupResult | null;
  remoteState: RemoteState;
}

export function initialWordLookup(): WordLookupState {
  return { local: null, localArticles: [], localDone: false, form: '', remote: null, remoteState: 'idle' };
}

/** The online lookup is needed when the offline entry is missing or has no translation (any article). */
export function needsRemote(best: LexEntry | null, variants: LexEntry[], lang: Lang): boolean {
  const untranslated = variants.length > 1 ? variants.some((v) => !v.tr[lang]) : !best?.tr[lang];
  return !best || untranslated;
}

/**
 * Look `word` up: offline dictionary (lemma, article variants), then — only if needed and
 * online — the online lookup. `onchange` gets a fresh state after each step; nothing is
 * reported once `signal` is aborted. Never throws.
 */
export async function loadWordInfo(
  word: string,
  opts: {
    /** Precomputed lemma (the reader's map); used when the offline lookup finds nothing. */
    entry?: LexEntry | null;
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
  let variants: LexEntry[] = [];
  let form = '';
  try {
    const hits = await lookupLocal(word);
    best = hits[0]?.entry ?? opts.entry ?? null;
    form = hits[0]?.entry && hits[0].form ? hits[0].form : '';
    if (best) variants = await articleVariants(best);
  } catch {
    // keep the precomputed entry
  }
  if (signal.aborted) return state;
  state.local = best;
  state.localArticles = variants;
  state.localDone = true;
  state.form = form;
  const remote = needsRemote(best, variants, lang) && opts.isOnline();
  if (remote) state.remoteState = 'loading';
  emit();
  if (!remote) return state;
  try {
    state.remote = await lookupWord(best?.term ?? word, lang, signal);
    state.remoteState = 'done';
  } catch {
    state.remoteState = 'failed';
  }
  emit();
  return state;
}

/** Everything known about the word, local entry first, gaps filled from the online lookup. */
export function mergeInfo(local: LexEntry | null, remote: LookupResult | null, lang: Lang): WordFields | null {
  const base = local ? fieldsFromEntry(local, lang) : null;
  const extra = remote ? fieldsFromLookup(remote) : null;
  if (!base && !extra) return null;
  if (!base) return { ...extra!, term: extra!.term! };
  if (!extra) return { ...base, term: base.term! };
  return {
    ...base,
    term: base.term!,
    translation: base.translation || extra.translation,
    genders: base.genders?.length ? base.genders : extra.genders,
    plural: base.plural || extra.plural,
    examples: extra.examples,
  };
}

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
