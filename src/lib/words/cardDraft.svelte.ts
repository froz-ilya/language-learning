// A word being added or edited: the card, what the dictionary filled in, the field's
// suggestions and the meaning chips. Shared by the add panel (QuickAdd, on the set page and on
// /card/new) and the edit page (/card/:id). Fields the screens draw are $state; the DOM (focus of
// the German field) is reached through focusField, which GermanField sets.
import { tick } from 'svelte';
import { online } from '../online.svelte';
import { settings } from '../settings.svelte';
import { db } from '../db/schema';
import { emptyCard, saveCard } from '../db/repo';
import { isHard, statusOf, type WordStatus } from '../progress';
import { parseGermanInput } from '../german/parseTerm';
import { joinMeanings, splitMeanings } from '../german/meanings';
import { ARTICLE, displayPlural, displayVerbForms } from '../german/articles';
import { lookupWordWithSource, mergeIntoCard, suggest } from '../lookup/lookup';
import type { ProviderId } from '../sources/chain';
import { systemName, t } from '../i18n.svelte';
import { rememberQuickAddSet } from '../share';
import { findDuplicate, quickAddDuplicate } from '../search/addToSet';
import { arrangeExamples, examplePool, phrasesForReading, phrasesToAdd } from '../lookup/examplePool';
import { isReflexiveTerm, withSich } from '../german/reflexive';
import { queryScript, reverseSearch } from '../dict/reverse';
import { reverseRows, searchWords, suggestionRows, type SearchGroups, type SearchRow } from '../search/results';
import { translationForPick } from '../search/pickTranslation';
import { showToast } from '../ui/dialogs.svelte';
import {
  baseTerm,
  CONTRACTIONS,
  formatPrep,
  mergePrepEntry,
  joiningPair,
  pairsFor,
  prepEntries,
  prepOfCard,
  resolveCase,
  TWO_WAY,
  withPrep,
  type PrepCase,
  type PrepPart,
} from '../german/prepositions';
import { joiningByMeaning, picksForPrep } from './prepReading';

/** "Er besteht auf seinem Recht." has "auf" (also as "aufs", "darauf"). */
const sentenceHas = (de: string, word: string) =>
  de
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .some((w) => w === word || CONTRACTIONS[w] === word || w === `da${word}` || w === `dar${word}`);
import type { ArticleVariant, Card, Example, Gender, Lang, LookupResult, ReflexiveReading } from '../types';

export type LookupState = 'idle' | 'loading' | 'done' | 'notfound' | 'error' | 'offline';
/** A card of this set, as far as the duplicate check and its "Open" need it. */
export type SetCard = Pick<Card, 'id' | 'term' | 'pos' | 'genders'> & { preps?: string };
/** The Russian / English word a German word was picked by (its translation follows it). */
export interface PickedFrom {
  text: string;
  lang: Lang;
}

/** The field's drop-down: German words, then words found by a Russian or English translation. */
export interface FieldSuggestions {
  german: SearchRow[];
  reverse: SearchRow[];
  /** Language of the reverse rows' hints (and their header); null when there are none. */
  reverseLang: Lang | null;
}

type Reading = ReflexiveReading & { phrases: Example[] };
/** A preposition the user typed, with how its case was known. */
type TypedPrep = PrepPart & { from?: string };
type LookupExamples = { byMeaning: Example[][]; examples: Example[]; phrases: Example[] };
const NO_EXAMPLES: LookupExamples = { byMeaning: [], examples: [], phrases: [] };
const NO_SUGGESTIONS: FieldSuggestions = { german: [], reverse: [], reverseLang: null };

export const MAX_GERMAN_ROWS = 5;
export const MAX_REVERSE_ROWS = 4;
/** A Cyrillic word has only reverse rows: a few more of them. */
export const MAX_RUSSIAN_ROWS = 6;
const SUGGEST_DELAY_MS = 300;

/** Is this typed text Russian (Cyrillic)? A German card never is. */
export const isCyrillic = (text: string) => queryScript(text) === 'ru';

export function fieldSuggestions(g: SearchGroups): FieldSuggestions {
  if (g.russian.length) return { german: [], reverse: g.russian.slice(0, MAX_RUSSIAN_ROWS), reverseLang: 'ru' };
  const english = g.english.slice(0, MAX_REVERSE_ROWS);
  return { german: g.german.slice(0, MAX_GERMAN_ROWS), reverse: english, reverseLang: english.length ? 'en' : null };
}

export interface DraftOptions {
  isNew: boolean;
  setId?: number;
  term?: string;
  cardId?: number;
}

export class CardDraft {
  /** Adding a word (QuickAdd), not editing one. */
  get isNew(): boolean {
    return this.opts.isNew;
  }

  card = $state<Card>(emptyCard(0));
  loaded = $state(false);
  missing = $state(false);
  setName = $state('');
  /** Edit mode: the word's status, and whether it's a hard word (missed HARD_MISSES+ times). */
  status = $state<WordStatus>('new');
  hard = $state(false);
  misses = $state(0);
  showDetails = $state(false);
  error = $state('');
  /** The German field has focus (buttons then keep it, so the iOS keyboard stays up). */
  focused = $state(false);

  /** The set's cards (new words): a word the set has already gets "Open" instead of Add. */
  setCards = $state.raw<SetCard[]>([]);

  /** Has a dictionary lookup filled this card (or was it already filled before editing)? */
  filled = false;
  /** Values the last lookup put into free-text fields; a re-lookup only replaces untouched ones. */
  auto = $state({ translation: '', examples: '', preps: '' });
  /** The card's examples are still the ones the lookup put in (not edited by hand). */
  examplesAuto = $derived(JSON.stringify(this.card.examples) === this.auto.examples);

  // ---------- Lookup ----------

  lookupState = $state<LookupState>('idle');
  lemmaNote = $state('');
  via = $state<ProviderId | null>(null);
  /** Articles of a noun whose articles differ in meaning (der See / die See), from the last lookup. */
  articles = $state<ArticleVariant[]>([]);
  /** The last lookup's verb and its two readings, when it has a "sich" one (new words). */
  reflexive = $state.raw<{ base: string; plain: Reading; refl: ReflexiveReading } | null>(null);
  /** The word was picked by a Russian / English word: its translation starts from that word. */
  pickedFrom = $state.raw<PickedFrom | null>(null);
  /** A Latin word the dictionary doesn't know may be English: German words it translates. */
  englishRows = $state.raw<SearchRow[]>([]);
  lastLookedUp = '';
  /**
   * Prepositions that are part of the looked-up word, for the switch ("bestehen | bestehen aus |
   * bestehen auf"): the list's joining pairs and the ones the dictionary's meanings tie a meaning
   * to (prepositions.ts). Other prepositions are a detail of the word (preps). Empty: no switch.
   */
  prepChoices = $state.raw<string[]>([]);
  /** The current reading's prepositions from the lookup (Card.preps format). */
  private readingPreps = '';
  /** Prepositions per meaning chip (aligned with meaningOptions), from the lookup. */
  private meaningPreps: string[][] = [];
  /** The reading's translation as the lookup gave it (the switch goes back to it). */
  private readingTr = '';
  /** The reading's examples and per-meaning prepositions (the switch goes back to them). */
  private readingEx: LookupExamples = NO_EXAMPLES;
  private readingMeaningPreps: string[][] = [];
  /** The preposition typed with the word ("denken an + Akk", "bestehen auf"), for the next lookup. */
  typedPrep = $state.raw<TypedPrep | null>(null);
  /** The preposition typed before a suggestion row was picked ("warten a…" → pick "warten"). */
  private pendingPrep: TypedPrep | null = null;
  /** Article picked from a suggestion row, asked for in the next lookup. */
  private wantGender: Gender | null = null;
  private lookupCtrl: AbortController | undefined;

  // ---------- Suggestions ----------

  suggestions = $state.raw<FieldSuggestions>(NO_SUGGESTIONS);
  /** The text `suggestions` belong to. */
  private suggestionsFor = '';
  private suggestTimer: ReturnType<typeof setTimeout> | undefined;
  private suggestCtrl: AbortController | undefined;
  /** The running search, so Return on a Russian word can wait for it. */
  private inflight: Promise<FieldSuggestions> | null = null;

  // ---------- Meanings + examples ----------

  /** Meanings of the looked-up translation ("последствие, результат; серия, эпизод; ряд"). */
  meaningOptions = $state<string[][]>([]);
  meaningPicked = $state<boolean[]>([]);
  meaningValue = $derived(joinMeanings(this.meaningOptions.filter((_, i) => this.meaningPicked[i])));
  /** Chips only while the field holds their selection: a hand edit hides them and is never overwritten. */
  showMeanings = $derived(this.meaningOptions.length > 1 && this.card.translation === this.meaningValue);

  /**
   * The last lookup's examples: per meaning (aligned with the meaning chips; empty when the source
   * has no numbered meanings), its default ones, and set phrases with translations.
   */
  lookupEx = $state.raw<LookupExamples>(NO_EXAMPLES);
  /** Candidate examples, best first: picked meanings', other meanings', then the rest. */
  pool = $derived(examplePool(this.lookupEx.byMeaning, this.showMeanings ? this.meaningPicked : [], this.lookupEx.examples));
  /** Index in `pool` of the example shown in the preview (the card's first). */
  private exampleShown = 0;
  /** Bumped when the shown example is swapped, to fade the new one in. */
  exampleSwap = $state(0);

  // ---------- Derived ----------

  duplicate = $derived(this.lookupState === 'loading' ? undefined : this.duplicateOf(this.card));
  pickedArticle = $derived(this.card.pos === 'noun' && this.card.genders.length === 1 ? this.card.genders[0] : null);
  canCycle = $derived(this.isNew && this.examplesAuto && this.pool.length > 1);
  /** Set phrases the card gets on save, after its sentence examples (see save). */
  phrases = $derived(this.isNew && this.examplesAuto ? phrasesToAdd(this.card.examples, this.lookupEx.phrases) : []);
  forms = $derived(this.card.pos === 'noun' ? displayPlural(this.card) : this.card.pos === 'verb' ? displayVerbForms(this.card) : '');
  /** "auf + Akk; über + Akk" → "auf + Akk · über + Akk" (the preview's line). */
  prepsLine = $derived(
    (this.card.preps ?? '')
      .split(';')
      .map((p) => p.trim())
      .filter((p) => p && (!this.prepOn || !p.startsWith(this.prepOn)))
      .join(' · '),
  );
  firstExample = $derived(this.card.examples.find((e) => e.de.trim()));
  reflexiveOn = $derived(isReflexiveTerm(this.card.term));
  /** The switcher's two options. */
  reflexiveOptions = $derived(
    this.reflexive
      ? [
          { id: 'plain', label: this.reflexive.base },
          { id: 'sich', label: withSich(this.reflexive.base) },
        ]
      : [],
  );
  /** The preposition the card is learned with ("warten auf" → auf), when it has one. */
  prepOn = $derived(prepOfCard(this.card)?.word ?? null);
  /** The term without the preposition ("warten auf" → "warten"). */
  prepBase = $derived(baseTerm(this.card));
  /** The preposition switch: "bestehen | bestehen auf" (new words, after a lookup). */
  prepOptions = $derived(
    this.prepChoices.length
      ? [{ id: '', label: this.prepBase }, ...this.prepChoices.map((w) => ({ id: w, label: withPrep(this.prepBase, w) }))]
      : [],
  );
  /**
   * The preposition typed as a detail of the word ("denken an"): before a lookup from the field's
   * text, after it the one kept from that text.
   */
  noteWord = $derived.by(() => {
    if (this.prepOn) return null;
    if (this.lookupState === 'idle') return parseGermanInput(this.card.term).note?.word ?? null;
    return this.typedPrep?.word ?? null;
  });
  /** The typed detail with its case as far as known ("an + Akk"). */
  noteEntry = $derived.by((): PrepPart | null => {
    const w = this.noteWord;
    if (!w) return null;
    const e = prepEntries(this.card.preps).find((x) => x.word === w) ?? parseGermanInput(this.card.term).note;
    if (!e) return { word: w };
    if (e.case) return { word: w, case: e.case };
    const c = resolveCase(baseTerm(this.card), w).case;
    return c ? { word: w, case: c } : { word: w };
  });
  /** The preposition the Akk / Dat picker is for: the word's own, else the typed one. */
  caseWord = $derived(this.prepOn ?? this.noteWord);
  /** A two-way preposition whose case nobody knows: the user picks Akk / Dat. */
  needsCase = $derived.by(() => {
    const w = this.caseWord;
    const e = w ? prepEntries(this.card.preps).find((x) => x.word === w) : undefined;
    return !!e && TWO_WAY.has(e.word) && !e.case;
  });
  /**
   * "denken an" typed while the set has "denken" without "an": the preposition goes to that card
   * (one word, the preposition a detail of it).
   */
  mergeTarget = $derived.by(() => {
    const dup = this.duplicate;
    const w = this.noteWord;
    if (!this.isNew || !dup || !w) return undefined;
    return prepEntries(dup.preps).some((e) => e.word === w) ? undefined : dup;
  });
  /** The typed text is Russian (new words): the field searches by translation. */
  cyrillic = $derived(this.isNew && isCyrillic(this.card.term));

  /** Focuses the German field (set by GermanField). */
  focusField: () => void = () => {};

  constructor(private readonly opts: DraftOptions) {
    this.showDetails = !opts.isNew;
    this.filled = !opts.isNew;
    if (opts.isNew) {
      this.card = { ...emptyCard(opts.setId ?? 0), term: opts.term ?? '' };
      this.loaded = true;
      void this.loadSetName();
      void this.loadSetCards();
    } else {
      const cardId = opts.cardId ?? 0;
      void Promise.all([db.cards.get(cardId), db.reviews.get(cardId)]).then(([c, r]) => {
        if (c) {
          this.card = c;
          this.filled = !c.needsFill;
          this.status = statusOf(c, r);
          this.hard = isHard(c, r);
          this.misses = r?.mistakes ?? 0;
        } else this.missing = true;
        this.loaded = true;
        void this.loadSetName();
      });
    }
  }

  /** Keeps focus in the German field when tapping a button (iOS keyboard stays up). */
  keepFocus = (e: PointerEvent) => {
    if (this.focused) e.preventDefault();
  };

  async loadSetName() {
    if (!this.card.setId) return;
    const set = await db.sets.get(this.card.setId);
    this.setName = set ? set.topic || systemName(set.name) : '';
  }

  async loadSetCards() {
    if (!this.card.setId) return;
    const cards = await db.cards.where('setId').equals(this.card.setId).toArray();
    const loadedIds = new Set(cards.map((c) => c.id));
    // Words added while this was loading are kept.
    this.setCards = [
      ...cards.map((c) => ({ id: c.id, term: c.term, pos: c.pos, genders: c.genders ?? [], preps: c.preps })),
      ...this.setCards.filter((c) => !loadedIds.has(c.id)),
    ];
  }

  /**
   * The set's card for this word, if it has one (new words only): same term, ignoring case, and
   * the same article when both have one (der See ≠ die See). See quickAddDuplicate.
   */
  duplicateOf(c: Pick<Card, 'term' | 'pos' | 'genders'>): SetCard | undefined {
    return this.isNew ? quickAddDuplicate(this.setCards, c, this.articles.length) : undefined;
  }

  /** ArticleChoices: an article the set has already gets a check instead of its "+". */
  articleInSet = (a: ArticleVariant) => !!findDuplicate(this.setCards, { term: this.card.term, pos: 'noun', genders: a.genders });

  /** A suggestion row the set has already (same word and article). */
  rowInSet = (r: SearchRow) =>
    !!findDuplicate(this.setCards, { term: r.term, pos: r.pos, genders: r.gender ? [r.gender] : r.genders });

  // ---------- Typed article / verb forms ----------

  /** "der Tisch" → term Tisch, noun, m. "gehen, ging, ist gegangen" → verb + forms. */
  applyParsed() {
    const card = this.card;
    const p = parseGermanInput(card.term);
    if (!p.term) return;
    // Already learned with this preposition (the dictionary's meanings joined it): stays so.
    if (p.note && prepOfCard(card)?.word === p.note.word) return;
    // "denken an + Akk", "bestehen auf": the card's prepositions get the typed entry.
    for (const part of p.prep ? [p.prep] : p.note ? [p.note] : prepEntries(p.preps)) this.applyTypedPrep(part);
    const changed = p.term !== card.term.trim() || p.pos;
    if (!changed) return;
    card.term = p.term;
    if (p.pos) card.pos = p.pos;
    if (p.genders.length) card.genders = p.genders;
    if (p.plural) card.plural = p.plural;
    if (p.praeteritum) card.praeteritum = p.praeteritum;
    if (p.partizip2) card.partizip2 = p.partizip2;
    if (p.auxiliary) card.auxiliary = p.auxiliary;
  }

  /**
   * "denken an + Akk" typed: the card's prepositions get that entry. One the card has already
   * keeps its case unless a case was typed (the user may have picked one).
   */
  private applyTypedPrep(p: TypedPrep) {
    const card = this.card;
    const has = prepEntries(card.preps).find((e) => e.word === p.word);
    if (has && (p.from !== 'typed' || has.case === p.case)) return;
    const merged = mergePrepEntry(card.preps, { word: p.word, ...(p.case ? { case: p.case } : {}) });
    const wasAuto = (card.preps ?? '') === this.auto.preps;
    card.preps = merged;
    if (this.isNew && wasAuto) this.auto.preps = merged;
  }

  // ---------- Suggestions ----------

  stopSuggest() {
    clearTimeout(this.suggestTimer);
    this.suggestCtrl?.abort();
    this.suggestions = NO_SUGGESTIONS;
    this.suggestionsFor = '';
    this.inflight = null;
  }

  /** A new word is being typed: drop what the previous lookup filled in (quick add only). */
  forgetLookup() {
    this.lookupCtrl?.abort();
    this.clearLookupExamples();
    this.lookupState = 'idle';
    this.lemmaNote = '';
    this.via = null;
    this.articles = [];
    this.wantGender = null;
    this.reflexive = null;
    this.pickedFrom = null;
    this.englishRows = [];
    this.prepChoices = [];
    this.readingPreps = '';
    this.meaningPreps = [];
    this.typedPrep = null;
    this.readingTr = '';
    if (!this.isNew || this.showDetails) return; // the full form may hold hand-typed details
    const card = this.card;
    card.pos = 'other';
    card.genders = [];
    card.plural = '';
    card.praeteritum = '';
    card.partizip2 = '';
    card.auxiliary = '';
    if (card.translation === this.auto.translation) card.translation = '';
    if (JSON.stringify(card.examples) === this.auto.examples) card.examples = [];
    if ((card.preps ?? '') === this.auto.preps) card.preps = undefined;
    this.auto = { translation: '', examples: '', preps: '' };
    this.clearMeanings();
    this.filled = false;
  }

  /** The text to search for: "gehen, gi" → "gehen"; a typed article stays ("die See"). */
  private searchText(): string {
    return this.card.term.split(',')[0].normalize('NFC').trim().replace(/\s+/g, ' ');
  }

  onInput() {
    this.error = '';
    const typed = this.card.term.trim();
    if (this.lookupState !== 'idle' && typed !== this.lastLookedUp) this.forgetLookup();
    else if (typed !== this.lastLookedUp) this.pickedFrom = null;
    clearTimeout(this.suggestTimer);
    this.suggestCtrl?.abort();
    const text = this.searchText();
    // "der Ti" → "Ti"; "denken an" → "denken" (the row picked gets the preposition back)
    const parsed = this.cyrillic ? null : parseGermanInput(text);
    const prefix = parsed ? (parsed.base ?? parsed.term) : text;
    this.pendingPrep = parsed?.prep ?? parsed?.note ?? null;
    if (prefix.length < 2) {
      this.suggestions = NO_SUGGESTIONS;
      this.suggestionsFor = '';
      this.inflight = null;
      return;
    }
    const query = this.isNew && !this.pendingPrep ? text : prefix;
    this.suggestTimer = setTimeout(() => void this.search(query), SUGGEST_DELAY_MS);
  }

  /**
   * New words: German words, and German words found by a Russian / English translation (as in
   * the quick search). Editing: German words only.
   */
  private search(text: string): Promise<FieldSuggestions> {
    clearTimeout(this.suggestTimer);
    this.suggestCtrl?.abort();
    const ctrl = new AbortController();
    this.suggestCtrl = ctrl;
    this.suggestionsFor = text;
    const lang = settings.lang;
    const set = (s: FieldSuggestions) => {
      if (!ctrl.signal.aborted) this.suggestions = s;
    };
    let p: Promise<FieldSuggestions>;
    if (this.isNew) {
      p = searchWords(text, lang, ctrl.signal, (g) => set(fieldSuggestions(g))).then((g) => {
        const s = fieldSuggestions(g);
        set(s);
        return s;
      });
    } else {
      p = suggest(text, lang, ctrl.signal)
        .then((list) => ({ german: suggestionRows(list.slice(0, 6), [], lang), reverse: [], reverseLang: null }))
        .catch(() => NO_SUGGESTIONS)
        .then((s) => {
          set(s);
          return s;
        });
    }
    this.inflight = p;
    return p;
  }

  /**
   * A row of the drop-down was picked. `fromLang`: the row was found by a Russian / English
   * translation, so the card's translation starts from it (see applyPick).
   */
  pick(row: SearchRow, fromLang: Lang | null = null) {
    const card = this.card;
    if (fromLang) {
      const typed = card.term.trim();
      card.term = row.term;
      card.pos = row.pos;
      card.genders = row.gender ? [row.gender] : [...row.genders];
      this.pickedFrom = { text: row.hint || typed, lang: fromLang };
    } else {
      const prep = this.pendingPrep;
      this.applyParsed(); // keep a typed article ("der Ti" → m)
      // "bestehen auf" typed, "bestehen" picked: "bestehen auf"; "denken an": the lookup adds "an".
      card.term = prep && joiningPair(row.term, prep.word) ? withPrep(row.term, prep.word) : row.term;
      this.typedPrep = prep;
      this.pickedFrom = null;
    }
    // A row of one article ("die See"): look that one up.
    this.wantGender = row.gender ?? null;
    this.stopSuggest();
    this.lastLookedUp = row.term; // a blur must not start a second lookup
    void this.runLookup(true);
  }

  /** Return / Look up on a Russian word: the first German word it translates, or why there's none. */
  private async pickFirstRussian(text: string) {
    let s = this.suggestions;
    if (this.suggestionsFor !== text || !s.reverse.length) {
      s = this.suggestionsFor === text && this.inflight ? await this.inflight : await this.search(text);
    }
    if (this.searchText() !== text) return; // typed on meanwhile
    const first = s.reverseLang === 'ru' ? s.reverse[0] : undefined;
    if (first) {
      this.pick(first, 'ru');
      return;
    }
    this.stopSuggest();
    this.error = online.value ? t('words.search.noGerman', { q: text }) : `${t('words.search.noGerman', { q: text })} ${t('words.search.russianOffline')}`;
  }

  // ---------- Lookup ----------

  /** `picked`: a row was just picked, so a Russian check doesn't apply (its term is German). */
  async runLookup(picked = false) {
    // The preposition typed ("denken an", "bestehen auf"), before applyParsed takes a detail out of the term.
    const typed = this.cyrillic ? null : parseGermanInput(this.card.term);
    const fromText = typed?.prep ?? typed?.note ?? null;
    this.applyParsed();
    const card = this.card;
    const word = card.term.trim();
    if (!word) {
      this.error = t('words.editor.typeFirst');
      this.focusField();
      return;
    }
    if (!picked && this.cyrillic) {
      this.error = '';
      await this.pickFirstRussian(this.searchText());
      return;
    }
    this.error = '';
    this.stopSuggest();
    this.clearMeanings();
    this.clearLookupExamples();
    this.lookupCtrl?.abort();
    const ctrl = new AbortController();
    this.lookupCtrl = ctrl;
    this.lastLookedUp = word;
    this.lookupState = 'loading';
    this.lemmaNote = '';
    this.via = null;
    this.articles = [];
    this.reflexive = null;
    this.englishRows = [];
    this.prepChoices = [];
    // "bestehen auf": looked up as "bestehen" (see lookup's prepare). A row was picked: the
    // preposition typed before it is kept, with a case typed then.
    const kept = this.typedPrep;
    this.typedPrep = fromText && kept?.word === fromText.word && kept.from === 'typed' ? kept : (fromText ?? (picked ? kept : null));
    // The article picked from a suggestion, or the one the card has: its meaning comes first.
    const gender = this.wantGender ?? (card.pos === 'noun' && card.genders.length === 1 ? card.genders[0] : null);
    this.wantGender = null;
    const query = gender && !parseGermanInput(word).genders.length ? `${ARTICLE[gender]} ${word}` : word;
    try {
      // Offline dictionary first, then online sources (see lib/sources); works offline for common words.
      let { result: r, via: from } = await lookupWordWithSource(query, settings.lang, ctrl.signal);
      let asTyped = false;
      if (!r && prepOfCard(card) && this.isNew) {
        // The word alone isn't known: maybe the whole phrase is.
        ({ result: r, via: from } = await lookupWordWithSource(query, settings.lang, ctrl.signal, true));
        asTyped = true;
      }
      if (ctrl.signal.aborted) return;
      if (!r) {
        this.lookupState = online.value ? 'notfound' : 'offline';
        this.notFound(word, ctrl);
        return;
      }
      this.via = from;
      this.articles = r.articles && r.articles.length > 1 ? r.articles : [];
      this.applyResult(r, asTyped);
      this.applyPick();
      this.filled = true;
      this.lookupState = 'done';
      if (r.lemmaOf && r.lemmaOf !== r.term) this.lemmaNote = `${r.lemmaOf} → ${r.term}`;
      this.lastLookedUp = card.term.trim();
    } catch (e) {
      if (ctrl.signal.aborted || (e as Error).name === 'AbortError') return;
      console.warn('lookup failed', e);
      this.lookupState = online.value ? 'error' : 'offline';
      this.notFound(word, ctrl);
    }
  }

  /**
   * Nothing found, or no source reachable (new words): a word picked by its translation keeps
   * that translation (in the language words are translated into), and a Latin word may be
   * English: offer what it means (the reverse index works offline).
   */
  private notFound(word: string, ctrl: AbortController) {
    if (!this.isNew) return;
    const pf = this.pickedFrom;
    if (pf && pf.lang === settings.lang && !this.card.translation.trim()) {
      this.card.translation = pf.text;
      this.auto.translation = pf.text;
    }
    if (pf || queryScript(word) !== 'latin') return;
    void reverseSearch(word, 'en', MAX_REVERSE_ROWS + 4)
      .then((hits) => {
        if (!ctrl.signal.aborted && this.card.term.trim() === word) this.englishRows = reverseRows(hits).slice(0, MAX_REVERSE_ROWS);
      })
      .catch(() => {});
  }

  /** `asTyped`: the result is for the whole typed text, not the word before its preposition. */
  applyResult(r: LookupResult, asTyped = false) {
    if (!this.isNew) {
      // Existing card: only fill what's empty.
      const merged = mergeIntoCard($state.snapshot(this.card) as Card, r);
      this.card = { ...merged, id: this.card.id, setId: this.card.setId };
      if (r.preps && !this.card.preps?.trim()) this.card.preps = r.preps;
      if (r.translation && this.card.translation.trim() === r.translation.trim()) this.offerMeanings();
      // "warten auf" typed into the term: the case the dictionary knows, when none was typed.
      const p = prepOfCard(this.card);
      if (p && !p.case) {
        const c = resolveCase(baseTerm(this.card), p.word, { lookup: r.preps }).case;
        if (c) this.card.preps = mergePrepEntry(this.card.preps, { word: p.word, case: c });
      }
      return;
    }
    const card = this.card;
    // New card: grammar comes from the dictionary; free text only replaces what the user didn't type.
    if (r.term) card.term = r.term;
    card.pos = r.pos;
    card.genders = [...r.genders];
    card.plural = r.plural;
    card.praeteritum = r.praeteritum;
    card.partizip2 = r.partizip2;
    card.auxiliary = r.auxiliary;
    this.setPreps(r.preps);
    if (r.translation && (!card.translation.trim() || card.translation === this.auto.translation)) {
      card.translation = r.translation;
      this.auto.translation = r.translation;
      this.offerMeanings();
    }
    this.lookupEx = { byMeaning: r.meaningExamples ?? [], examples: r.examples, phrases: r.phrases ?? [] };
    if (!card.examples.length || this.examplesAuto) this.fillExamples();
    // A verb with a "sich" reading next to its own (treffen / sich treffen): offer the switch.
    this.reflexive =
      r.reflexive && !isReflexiveTerm(card.term)
        ? {
            base: card.term.trim(),
            plain: {
              translation: r.translation,
              examples: r.examples,
              meaningExamples: r.meaningExamples,
              preps: r.preps,
              phrases: r.phrases ?? [],
            },
            refl: r.reflexive,
          }
        : null;
    this.readingPreps = r.preps ?? '';
    this.meaningPreps = r.meaningPreps ?? [];
    this.keepReading();
    if (asTyped) {
      this.typedPrep = null;
      return;
    }
    // "freuen über", "verlassen auf": the preposition goes with the "sich" reading.
    const word = this.typedPrep?.word;
    const has = (preps?: string) => !!word && prepEntries(preps).some((e) => e.word === word);
    const reflPair = !!word && pairsFor(card.term).some((x) => x.word === word && isReflexiveTerm(x.base));
    if (word && this.reflexive && !has(r.preps) && (has(r.reflexive?.preps) || reflPair)) {
      this.chooseReflexive(true);
      return;
    }
    this.applyPrepDefault(word ?? null);
  }

  // ---------- Preposition (warten / warten auf) ----------

  /**
   * After a lookup or a change of reading: the prepositions that are part of the word (for the
   * switch), and the card's — `keep` when it is one of them (typed, or kept from the other
   * reading), else none. A typed preposition that isn't part of the word is a detail of it
   * (preps): "denken an" is the card "denken" with "an + Akk".
   */
  private applyPrepDefault(keep: string | null) {
    if (!this.isNew) return;
    const base = baseTerm(this.card);
    const refl = isReflexiveTerm(base);
    const listed = pairsFor(base)
      .filter((p) => p.joins && isReflexiveTerm(p.base) === refl)
      .map((p) => p.word);
    // The dictionary's meanings can join a preposition the list doesn't know; one the list has
    // as a detail of the word (warten auf: ждать is also "warten") stays a detail.
    const detail = new Set(pairsFor(base).filter((p) => !p.joins).map((p) => p.word));
    const fromMeanings = joiningByMeaning(this.meaningPreps).filter((w) => !detail.has(w));
    const joining = [...new Set([...listed, ...fromMeanings])];
    this.prepChoices = joining.slice(0, 3);
    const want = keep && this.prepChoices.includes(keep) ? keep : null;
    this.setPrep(want);
    if (!want && this.typedPrep) this.addNote(this.typedPrep);
  }

  /** The preposition switch: the card becomes "bestehen auf" (or "bestehen"). */
  choosePrep(word: string | null) {
    if ((word || null) === this.prepOn) return;
    this.setPrep(word || null);
  }

  private setPrep(word: string | null) {
    const card = this.card;
    const base = baseTerm(card);
    card.term = word ? withPrep(base, word) : base;
    // The typed text is this word now: Return adds it, typing on starts a new word.
    this.lastLookedUp = card.term.trim();
    if (word) {
      const t = this.typedPrep;
      const typed = t?.word === word && t.from === 'typed' ? t.case : undefined;
      const r = resolveCase(base, word, { typed, lookup: this.readingPreps });
      const part: PrepPart = r.case ? { word, case: r.case } : { word };
      if (card.preps?.trim() && card.preps !== this.auto.preps) card.preps = mergePrepEntry(card.preps, part);
      else this.setPreps(formatPrep(part));
    } else {
      this.setPreps(this.readingPreps || undefined);
    }
    this.meaningsFor(base, word);
  }

  /** A preposition that is a detail of the word ("denken an"): added to its prepositions. */
  private addNote(p: TypedPrep) {
    const card = this.card;
    const typed = p.from === 'typed' ? p.case : undefined;
    const r = resolveCase(baseTerm(card), p.word, { typed, lookup: this.readingPreps });
    const wasAuto = (card.preps ?? '') === this.auto.preps;
    card.preps = mergePrepEntry(card.preps, r.case ? { word: p.word, case: r.case } : { word: p.word });
    if (wasAuto) this.auto.preps = card.preps;
  }

  /**
   * The meanings for the word with (or without) its preposition: a joining pair's own meaning
   * (bestehen auf → настаивать) is the one selected — a chip that says it, else in front as a
   * meaning of its own; otherwise the meanings the dictionary ties to it. Without: the reading's.
   * Only while the translation is still the lookup's.
   */
  private meaningsFor(base: string, word: string | null) {
    const card = this.card;
    if (!this.readingTr || card.translation !== this.auto.translation) return;
    this.lookupEx = this.readingEx;
    this.meaningPreps = this.readingMeaningPreps;
    card.translation = this.readingTr;
    this.auto.translation = this.readingTr;
    this.clearMeanings();
    this.offerMeanings();
    const own = word ? joiningPair(base, word)?.joins?.[settings.lang] : undefined;
    if (word && own) {
      const res = translationForPick(splitMeanings(card.translation), own, settings.lang, settings.lang);
      if (res) {
        this.meaningOptions = res.meanings.length > 1 ? res.meanings : [];
        this.meaningPicked = res.meanings.length > 1 ? res.picked : [];
        card.translation = joinMeanings(res.meanings.filter((_, i) => res.picked[i]));
        this.auto.translation = card.translation;
        if (res.prepended) {
          // The meaning is ours, not the dictionary's: only examples with the preposition fit it.
          const fits = (e: Example) => sentenceHas(e.de, word);
          const ex = this.lookupEx;
          this.lookupEx = {
            ...ex,
            byMeaning: ex.byMeaning.length ? [ex.byMeaning.flat().filter(fits), ...ex.byMeaning.map((l) => l.filter(fits))] : [],
            examples: ex.examples.filter(fits),
            phrases: ex.phrases.filter(fits),
          };
          if (this.meaningPreps.length) this.meaningPreps = [[], ...this.meaningPreps];
        }
      }
    } else if (word && this.meaningOptions.length > 1) {
      const picks = picksForPrep(this.meaningPreps, word);
      if (picks && picks.length === this.meaningOptions.length) {
        this.meaningPicked = picks;
        card.translation = this.meaningValue;
        this.auto.translation = card.translation;
      }
    }
    if (this.isNew && this.examplesAuto) this.fillExamples();
  }

  /** After a lookup or a change of reading: what the preposition switch goes back to. */
  private keepReading() {
    const card = this.card;
    this.readingTr = card.translation === this.auto.translation ? card.translation : '';
    this.readingEx = this.lookupEx;
    this.readingMeaningPreps = this.meaningPreps;
  }

  /** The case after a two-way preposition nobody knew ("denken an": Akk). */
  pickCase(c: PrepCase) {
    const w = this.caseWord;
    if (!w) return;
    const wasAuto = (this.card.preps ?? '') === this.auto.preps;
    this.card.preps = mergePrepEntry(this.card.preps, { word: w, case: c });
    if (wasAuto) this.auto.preps = this.card.preps;
  }

  /**
   * "denken an" typed while the set has "denken": that card gets "an + Akk" in its prepositions
   * (its term and progress stay). Returns the updated card, or null when there was nothing to do.
   */
  async mergePrepIntoDuplicate(): Promise<Card | null> {
    const dup = this.mergeTarget;
    const entry = this.noteEntry;
    if (!dup || !entry || dup.id === undefined) return null;
    const c = await db.cards.get(dup.id);
    if (!c) return null;
    const updated: Card = { ...c, preps: mergePrepEntry(c.preps, entry) };
    await saveCard(updated);
    this.setCards = this.setCards.map((x) => (x.id === c.id ? { ...x, preps: updated.preps } : x));
    showToast(t('words.editor.prepAdded', { word: c.term, prep: formatPrep(entry) }));
    return updated;
  }

  /**
   * The word was picked by a Russian / English word in the language words are translated into:
   * that meaning is the one selected, or the typed word goes in front (translationForPick).
   */
  private applyPick() {
    const pf = this.pickedFrom;
    const card = this.card;
    if (!this.isNew || !pf || card.translation !== this.auto.translation) return;
    const res = translationForPick(splitMeanings(card.translation), pf.text, pf.lang, settings.lang);
    if (!res) return;
    this.meaningOptions = res.meanings;
    this.meaningPicked = res.picked;
    card.translation = joinMeanings(res.meanings.filter((_, i) => res.picked[i]));
    this.auto.translation = card.translation;
    // Examples per meaning stay aligned with the chips.
    if (res.prepended && this.lookupEx.byMeaning.length) this.lookupEx = { ...this.lookupEx, byMeaning: [[], ...this.lookupEx.byMeaning] };
    if (res.prepended && this.meaningPreps.length) this.meaningPreps = [[], ...this.meaningPreps];
    if (this.examplesAuto) this.fillExamples();
  }

  /** The dictionary's prepositions, unless the user typed their own (new words). */
  private setPreps(preps: string | undefined) {
    if (this.card.preps?.trim() && this.card.preps !== this.auto.preps) return;
    this.card.preps = preps || undefined;
    this.auto.preps = preps ?? '';
  }

  /**
   * The user picked one article ("die See"): the card becomes that word — its article, plural,
   * meaning and examples. A translation or example the user typed is kept.
   */
  chooseArticle = (a: ArticleVariant) => {
    const card = this.card;
    const others = this.articles.map((x) => x.translation.trim());
    const translationIsAuto = !card.translation.trim() || card.translation === this.auto.translation || others.includes(card.translation.trim());
    card.pos = 'noun';
    card.genders = [...a.genders];
    if (a.plural || this.isNew) card.plural = a.plural;
    if (translationIsAuto) {
      card.translation = a.translation;
      this.auto.translation = a.translation;
      this.clearMeanings();
      this.offerMeanings();
    }
    // The article's own examples; the word's set phrases stay.
    this.lookupEx = { byMeaning: a.meaningExamples ?? [], examples: a.examples, phrases: this.lookupEx.phrases };
    if (!card.examples.some((e) => e.de.trim()) || this.examplesAuto) {
      if (this.isNew) this.fillExamples();
      else {
        card.examples = a.examples.map((e) => ({ de: e.de, tr: e.tr ?? '' }));
        this.auto.examples = JSON.stringify(card.examples);
      }
    }
  };

  // ---------- Reflexive reading (treffen / sich treffen) ----------

  /**
   * The card becomes "sich treffen" (or back "treffen"): that reading's translation, examples
   * and prepositions. A translation or example the user typed is kept (see chooseArticle).
   */
  chooseReflexive(on: boolean) {
    if (!this.reflexive || on === this.reflexiveOn) return;
    const card = this.card;
    const { base, plain, refl } = this.reflexive;
    const keepPrep = this.prepOn ?? this.typedPrep?.word ?? null;
    const reading: Reading = on ? { ...refl, phrases: phrasesForReading(plain.phrases, true) } : plain;
    const other = (on ? plain : refl).translation.trim();
    const translationIsAuto = !card.translation.trim() || card.translation === this.auto.translation || card.translation.trim() === other;
    card.term = on ? withSich(base) : base;
    // The typed text is this word now: Return adds it, typing on starts a new word.
    this.lastLookedUp = card.term.trim();
    if (translationIsAuto && reading.translation.trim()) {
      card.translation = reading.translation;
      this.auto.translation = reading.translation;
      this.clearMeanings();
      this.offerMeanings();
    }
    this.setPreps(reading.preps);
    this.lookupEx = { byMeaning: reading.meaningExamples ?? [], examples: reading.examples, phrases: reading.phrases };
    if (!card.examples.some((e) => e.de.trim()) || this.examplesAuto) this.fillExamples();
    // The preposition follows: kept when this reading has it too (sich freuen über).
    this.readingPreps = reading.preps ?? '';
    this.meaningPreps = reading.meaningPreps ?? [];
    this.keepReading();
    this.applyPrepDefault(keepPrep);
  }

  // ---------- Meanings ----------

  /** The lookup just put its translation into the field: offer its meanings as chips, all selected. */
  private offerMeanings() {
    const meanings = splitMeanings(this.card.translation);
    if (meanings.length < 2) return this.clearMeanings();
    this.meaningOptions = meanings;
    this.meaningPicked = meanings.map(() => true);
    const value = joinMeanings(meanings);
    if (this.card.translation === this.auto.translation) this.auto.translation = value;
    this.card.translation = value;
  }

  private clearMeanings() {
    this.meaningOptions = [];
    this.meaningPicked = [];
  }

  toggleMeaning(i: number) {
    if (this.meaningPicked[i] && this.meaningPicked.filter(Boolean).length === 1) return; // keep at least one
    const wasAuto = this.card.translation === this.auto.translation;
    this.meaningPicked[i] = !this.meaningPicked[i];
    this.card.translation = this.meaningValue;
    // Still the dictionary's text: a re-lookup or the next word may replace it.
    if (wasAuto) this.auto.translation = this.card.translation;
    // The example follows the meanings kept (unless the examples were edited by hand).
    if (this.isNew && this.examplesAuto) this.fillExamples();
  }

  // ---------- Examples (new words) ----------

  private clearLookupExamples() {
    this.lookupEx = NO_EXAMPLES;
    this.exampleShown = 0;
  }

  /** The card gets the pool's examples, pool[shown] first; they stay the lookup's (auto). */
  fillExamples(shown = 0) {
    const was = this.card.examples[0]?.de;
    this.exampleShown = shown;
    this.card.examples = arrangeExamples(this.pool, shown);
    this.auto.examples = JSON.stringify(this.card.examples);
    if (this.card.examples[0]?.de !== was) this.exampleSwap++;
  }

  anotherExample() {
    if (this.pool.length > 1) this.fillExamples((this.exampleShown + 1) % this.pool.length);
  }

  // ---------- Save ----------

  private detailsMissing(c: Card): boolean {
    if (!c.translation.trim() || c.pos === 'other') return true;
    if (c.pos === 'noun') return !c.genders.length || !c.plural.trim();
    if (c.pos === 'verb') return !c.praeteritum.trim() || !c.partizip2.trim();
    return false;
  }

  /** Saves the card; returns it with its id, or null when it couldn't be saved (`error` says why). */
  async save(): Promise<Card | null> {
    this.applyParsed();
    const card = this.card;
    if (!card.term.trim()) {
      this.error = t('words.editor.enterWord');
      this.focusField();
      return null;
    }
    // The add field also takes Russian words, to find German ones: never a card of one.
    if (this.cyrillic) {
      this.error = t('words.editor.notGerman');
      this.focusField();
      return null;
    }
    if (!card.setId) {
      this.error = t('words.editor.noSet');
      return null;
    }
    const c = $state.snapshot(card) as Card;
    if (c.pos !== 'noun') {
      c.genders = [];
      c.plural = '';
    }
    if (c.pos !== 'verb') {
      c.praeteritum = '';
      c.partizip2 = '';
      c.auxiliary = '';
    }
    c.examples = c.examples.map((e) => ({ de: e.de.trim(), tr: (e.tr ?? '').trim() }));
    // Prepositions as typed, trimmed; none → no field (cards saved before it existed have none).
    const preps = c.preps?.trim();
    if (preps) c.preps = preps;
    else delete c.preps;
    // The lookup's set phrases go after its sentences (not when the examples were edited by hand).
    if (this.isNew && this.examplesAuto) c.examples.push(...phrasesToAdd(c.examples, this.lookupEx.phrases));
    c.needsFill = !this.filled && this.detailsMissing(c) ? 1 : 0;
    // The full form's Add and a second Return go through here too: never a second card for a word.
    const dup = this.duplicateOf(c);
    if (dup) {
      this.error = t('words.editor.inSetError', { word: dup.term });
      return null;
    }
    const id = await saveCard(c);
    if (this.isNew) {
      rememberQuickAddSet(c.setId); // shared words (Share.svelte) go to the same set
      this.setCards = [...this.setCards, { id, term: c.term.trim(), pos: c.pos, genders: c.genders }];
    }
    return { ...c, id };
  }

  /** After a quick add: an empty card for the next word, in the same set. */
  async resetForNext() {
    this.lookupCtrl?.abort();
    this.stopSuggest();
    this.card = emptyCard(this.card.setId);
    this.filled = false;
    this.auto = { translation: '', examples: '', preps: '' };
    this.reflexive = null;
    this.pickedFrom = null;
    this.englishRows = [];
    this.prepChoices = [];
    this.readingPreps = '';
    this.meaningPreps = [];
    this.typedPrep = null;
    this.pendingPrep = null;
    this.readingTr = '';
    this.clearMeanings();
    this.clearLookupExamples();
    this.lookupState = 'idle';
    this.lemmaNote = '';
    this.via = null;
    this.articles = [];
    this.lastLookedUp = '';
    this.showDetails = false;
    this.error = '';
    await tick();
  }

  /** Clear the field (the × button). */
  clearTerm() {
    this.card.term = '';
    this.forgetLookup();
    this.stopSuggest();
    this.lastLookedUp = '';
    this.error = '';
  }

  destroy() {
    this.lookupCtrl?.abort();
    this.suggestCtrl?.abort();
    clearTimeout(this.suggestTimer);
  }
}
