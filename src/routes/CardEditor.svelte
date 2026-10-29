<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { fade, fly, slide } from 'svelte/transition';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Term from '../components/Term.svelte';
  import SpeakButton from '../components/SpeakButton.svelte';
  import UmlautBar from '../components/UmlautBar.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import ArticleChoices from '../components/ArticleChoices.svelte';
  import { back, go, route } from '../lib/router.svelte';
  import { dur } from '../lib/motion';
  import { online } from '../lib/online.svelte';
  import { settings } from '../lib/settings.svelte';
  import { db } from '../lib/db/schema';
  import { deleteCard, emptyCard, saveCard } from '../lib/db/repo';
  import { isHard, setKnown, statusOf, STATUS_LABELS, type WordStatus } from '../lib/progress';
  import { parseGermanInput } from '../lib/german/parseTerm';
  import { joinMeanings, splitMeanings } from '../lib/german/meanings';
  import { ARTICLE, displayPlural, displayTerm, displayVerbForms, speakableTerm } from '../lib/german/articles';
  import { lookupWordWithSource, mergeIntoCard, suggest, type Suggestion } from '../lib/lookup/lookup';
  import { PROVIDER_LABELS, type ProviderId } from '../lib/sources/chain';
  import { showToast, undoToast } from '../lib/ui/dialogs.svelte';
  import { rememberQuickAddSet } from '../lib/share';
  import { findDuplicate, quickAddDuplicate } from '../lib/search/addToSet';
  import { takeKeyboard } from '../lib/ui/keyboard';
  import type { ArticleVariant, Card, Gender, LookupResult, Pos } from '../lib/types';

  /*
   * New word  → "Quick add": type → dictionary preview → ✓ Add (keyboard stays up for the next
   *             word). "Edit details" slides the full form open.
   * Edit word → the full form, a status row (Mark known / Not learned) and Delete with Undo.
   */
  const isNew = route.parts[1] === 'new';
  const cardId = isNew ? 0 : Number(route.parts[1]);

  /** A word passed in (#/card/new?set=…&term=…, e.g. shared from another app): filled in and looked up. */
  const givenTerm = isNew ? (route.query.get('term') ?? '').trim() : '';

  let card = $state<Card>({ ...emptyCard(Number(route.query.get('set')) || 0), term: givenTerm });
  let loaded = $state(isNew);
  let missing = $state(false);
  let setName = $state('');
  let status = $state<WordStatus>('new');
  let showDetails = $state(!isNew);

  /** A card of this set, as far as the duplicate check and its "Open" need it. */
  type SetCard = Pick<Card, 'id' | 'term' | 'pos' | 'genders'>;
  /** Words added since this screen opened, newest first (quick add only; gone when leaving). */
  type AddedWord = SetCard & { id: number; translation: string };
  /** The set's cards (quick add): a word the set has already gets "Open" instead of Add. */
  let setCards = $state.raw<SetCard[]>([]);
  let added = $state.raw<AddedWord[]>([]);

  /** Has a dictionary lookup filled this card (or was it already filled before editing)? */
  let filled = isNew ? false : true;
  /** Values the last lookup put into free-text fields; a re-lookup only replaces untouched ones. */
  let auto = { translation: '', examples: '' };

  let germanEl = $state<HTMLInputElement>();
  let notesEl = $state<HTMLTextAreaElement>();
  /** Missed HARD_MISSES+ times and not learned yet: nudge towards a memory hook. */
  let hard = $state(false);
  let misses = $state(0);
  let translationEl = $state<HTMLInputElement>();
  let error = $state('');

  if (!isNew) {
    Promise.all([db.cards.get(cardId), db.reviews.get(cardId)]).then(([c, r]) => {
      if (c) {
        card = c;
        filled = !c.needsFill;
        status = statusOf(c, r);
        hard = isHard(c, r);
        misses = r?.mistakes ?? 0;
      } else missing = true;
      loaded = true;
      loadSetName();
    });
  } else {
    loadSetName();
    loadSetCards();
  }

  async function loadSetName() {
    if (!card.setId) return;
    const set = await db.sets.get(card.setId);
    setName = set ? set.topic || set.name : '';
  }

  async function loadSetCards() {
    if (!card.setId) return;
    const cards = await db.cards.where('setId').equals(card.setId).toArray();
    const loadedIds = new Set(cards.map((c) => c.id));
    // Words added while this was loading are kept.
    setCards = [
      ...cards.map((c) => ({ id: c.id, term: c.term, pos: c.pos, genders: c.genders ?? [] })),
      ...setCards.filter((c) => !loadedIds.has(c.id)),
    ];
  }

  const backTo = $derived(card.setId ? `/set/${card.setId}` : '/');
  const lang = $derived(settings.lang.toUpperCase());
  const forms = $derived(card.pos === 'noun' ? displayPlural(card) : card.pos === 'verb' ? displayVerbForms(card) : '');
  const firstExample = $derived(card.examples.find((e) => e.de.trim()));

  // ---------- Typed article / verb forms ----------

  /** "der Tisch" → term Tisch, noun, m. "gehen, ging, ist gegangen" → verb + forms. */
  function applyParsed() {
    const p = parseGermanInput(card.term);
    if (!p.term) return;
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

  // ---------- Suggestions ----------

  let suggestions = $state<Suggestion[]>([]);
  let focused = $state(false);
  let suggestTimer: ReturnType<typeof setTimeout> | undefined;
  let suggestCtrl: AbortController | undefined;
  let suggestEl = $state<HTMLElement>();
  /** A finger / mouse is down on a suggestion: the field's blur must not act before the pick. */
  let picking = false;
  /** The field's blur is handled a moment later, so a tap on a suggestion can win (see afterBlur). */
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  const BLUR_GRACE_MS = 120;

  function stopSuggest() {
    clearTimeout(suggestTimer);
    suggestCtrl?.abort();
    suggestions = [];
  }

  /** A new word is being typed: drop what the previous lookup filled in (quick add only). */
  function forgetLookup() {
    lookupCtrl?.abort();
    lookupState = 'idle';
    lemmaNote = '';
    via = null;
    articles = [];
    wantGender = null;
    if (!isNew || showDetails) return; // the full form may hold hand-typed details
    card.pos = 'other';
    card.genders = [];
    card.plural = '';
    card.praeteritum = '';
    card.partizip2 = '';
    card.auxiliary = '';
    if (card.translation === auto.translation) card.translation = '';
    if (JSON.stringify(card.examples) === auto.examples) card.examples = [];
    auto = { translation: '', examples: '' };
    clearMeanings();
    filled = false;
  }

  function onGermanInput() {
    error = '';
    if (lookupState !== 'idle' && card.term.trim() !== lastLookedUp) forgetLookup();
    clearTimeout(suggestTimer);
    suggestCtrl?.abort();
    // "der Ti" → "Ti"; "gehen, gi" → "gehen"
    const prefix = parseGermanInput(card.term).term.split(',')[0].trim();
    if (prefix.length < 2) {
      suggestions = [];
      return;
    }
    suggestTimer = setTimeout(async () => {
      const ctrl = new AbortController();
      suggestCtrl = ctrl;
      try {
        const list = await suggest(prefix, settings.lang, ctrl.signal);
        if (!ctrl.signal.aborted) suggestions = list.slice(0, 6);
      } catch {
        if (!ctrl.signal.aborted) suggestions = [];
      }
    }, 300);
  }

  function pickSuggestion(s: Suggestion) {
    // The tap may have blurred the field already (iOS): its deferred blur must not look up the typed text.
    picking = false;
    clearTimeout(blurTimer);
    applyParsed(); // keep a typed article ("der Ti" → m)
    card.term = s.word;
    // A row of one article ("die See"): look that one up.
    wantGender = s.genders?.[0] ?? null;
    stopSuggest();
    lastLookedUp = s.word; // a blur below must not start a second lookup
    if (isNew) {
      germanEl?.focus(); // quick add keeps the keyboard up for the next word (inside the tap, for iOS)
    } else {
      germanEl?.blur();
      focused = false;
    }
    void runLookup();
  }

  /**
   * Suggestion buttons keep the field focused. iOS may still blur it on a tap, so `picking` also
   * holds back the deferred blur until the click arrives or the pointer is released elsewhere.
   */
  function onSuggestionPointerdown(e: PointerEvent) {
    picking = true;
    keepFocus(e);
  }

  /** Released without a pick (finger slid off, list scrolled): finish the held-back blur. */
  function onWindowPointerEnd() {
    if (!picking) return;
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      picking = false;
      afterBlur();
    }, BLUR_GRACE_MS);
  }

  function onGermanFocus() {
    clearTimeout(blurTimer);
    focused = true;
  }

  function onGermanBlur() {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(afterBlur, BLUR_GRACE_MS);
  }

  /** Keyboard focus left the suggestion list (Tab): handle it like leaving the field. */
  function onSuggestionsFocusout(e: FocusEvent) {
    if (e.relatedTarget instanceof Node && suggestEl?.contains(e.relatedTarget)) return;
    clearTimeout(blurTimer);
    blurTimer = setTimeout(afterBlur, BLUR_GRACE_MS);
  }

  function afterBlur() {
    const active = document.activeElement;
    if (picking || active === germanEl || (active && suggestEl?.contains(active))) return;
    focused = false;
    applyParsed();
    // Leaving the field with a fresh word on a new card: look it up automatically.
    if (isNew && card.term.trim() && card.term.trim() !== lastLookedUp && !card.translation.trim()) {
      void runLookup();
    }
  }

  function onGermanKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // Quick add: Return looks the word up, a second Return adds it.
    if (isNew && !showDetails && lookupState === 'done' && card.term.trim() === lastLookedUp) void quickAdd();
    else void runLookup();
  }

  function clearTerm() {
    card.term = '';
    forgetLookup();
    stopSuggest();
    lastLookedUp = '';
    germanEl?.focus();
  }

  // ---------- Lookup ----------

  type LookupState = 'idle' | 'loading' | 'done' | 'notfound' | 'error' | 'offline';
  let lookupState = $state<LookupState>('idle');
  let lemmaNote = $state('');
  let via = $state<ProviderId | null>(null);
  let lookupCtrl: AbortController | undefined;
  let lastLookedUp = '';
  /** Articles of a noun whose articles differ in meaning (der See / die See), from the last lookup. */
  let articles = $state<ArticleVariant[]>([]);
  /** Article picked from a suggestion row, asked for in the next lookup. */
  let wantGender: Gender | null = null;
  const pickedArticle = $derived(card.pos === 'noun' && card.genders.length === 1 ? card.genders[0] : null);

  /**
   * The set's card for this word, if it has one (new words only): same term, ignoring case, and
   * the same article when both have one (der See ≠ die See). See quickAddDuplicate.
   */
  function duplicateOf(c: Pick<Card, 'term' | 'pos' | 'genders'>): SetCard | undefined {
    return isNew ? quickAddDuplicate(setCards, c, articles.length) : undefined;
  }

  const duplicate = $derived(lookupState === 'loading' ? undefined : duplicateOf(card));
  /** ArticleChoices: an article the set has already gets a check instead of its "+". */
  const articleInSet = (a: ArticleVariant) => !!findDuplicate(setCards, { term: card.term, genders: a.genders });

  async function runLookup() {
    applyParsed();
    const word = card.term.trim();
    if (!word) {
      error = 'Type a German word first.';
      germanEl?.focus();
      return;
    }
    stopSuggest();
    clearMeanings();
    lookupCtrl?.abort();
    const ctrl = new AbortController();
    lookupCtrl = ctrl;
    lastLookedUp = word;
    lookupState = 'loading';
    lemmaNote = '';
    via = null;
    articles = [];
    // The article picked from a suggestion, or the one the card has: its meaning comes first.
    const gender = wantGender ?? (card.pos === 'noun' && card.genders.length === 1 ? card.genders[0] : null);
    wantGender = null;
    const query = gender && !parseGermanInput(word).genders.length ? `${ARTICLE[gender]} ${word}` : word;
    try {
      // Offline dictionary first, then online sources (see lib/sources); works offline for common words.
      const { result: r, via: from } = await lookupWordWithSource(query, settings.lang, ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (!r) {
        lookupState = online.value ? 'notfound' : 'offline';
        return;
      }
      via = from;
      articles = r.articles && r.articles.length > 1 ? r.articles : [];
      applyResult(r);
      filled = true;
      lookupState = 'done';
      if (r.lemmaOf && r.lemmaOf !== r.term) lemmaNote = `${r.lemmaOf} → ${r.term}`;
      lastLookedUp = card.term.trim();
    } catch (e) {
      if (ctrl.signal.aborted || (e as Error).name === 'AbortError') return;
      console.warn('lookup failed', e);
      lookupState = online.value ? 'error' : 'offline';
    }
  }

  function applyResult(r: LookupResult) {
    if (!isNew) {
      // Existing card: only fill what's empty.
      const merged = mergeIntoCard($state.snapshot(card) as Card, r);
      card = { ...merged, id: card.id, setId: card.setId };
      if (r.translation && card.translation.trim() === r.translation.trim()) offerMeanings();
      return;
    }
    // New card: grammar comes from the dictionary; free text only replaces what the user didn't type.
    if (r.term) card.term = r.term;
    card.pos = r.pos;
    card.genders = [...r.genders];
    card.plural = r.plural;
    card.praeteritum = r.praeteritum;
    card.partizip2 = r.partizip2;
    card.auxiliary = r.auxiliary;
    if (r.translation && (!card.translation.trim() || card.translation === auto.translation)) {
      card.translation = r.translation;
      auto.translation = r.translation;
      offerMeanings();
    }
    const examplesNow = JSON.stringify(card.examples);
    if (r.examples.length && (!card.examples.length || examplesNow === auto.examples)) {
      card.examples = r.examples.map((e) => ({ de: e.de, tr: e.tr ?? '' }));
      auto.examples = JSON.stringify(card.examples);
    }
  }

  /**
   * The user picked one article ("die See"): the card becomes that word — its article, plural,
   * meaning and examples. A translation or example the user typed is kept.
   */
  function chooseArticle(a: ArticleVariant) {
    const others = articles.map((x) => x.translation.trim());
    const translationIsAuto = !card.translation.trim() || card.translation === auto.translation || others.includes(card.translation.trim());
    card.pos = 'noun';
    card.genders = [...a.genders];
    if (a.plural || isNew) card.plural = a.plural;
    if (translationIsAuto) {
      card.translation = a.translation;
      auto.translation = a.translation;
      clearMeanings();
      offerMeanings();
    }
    const examplesNow = JSON.stringify(card.examples);
    if (!card.examples.some((e) => e.de.trim()) || examplesNow === auto.examples) {
      card.examples = a.examples.map((e) => ({ de: e.de, tr: e.tr ?? '' }));
      auto.examples = JSON.stringify(card.examples);
    }
  }

  /** Quick add of one article straight from its row. */
  async function addArticle(a: ArticleVariant) {
    chooseArticle(a);
    await quickAdd();
  }

  $effect(() => () => {
    lookupCtrl?.abort();
    suggestCtrl?.abort();
    clearTimeout(suggestTimer);
    clearTimeout(blurTimer);
  });

  // ---------- Meanings ----------

  /** Meanings of the looked-up translation ("последствие, результат; серия, эпизод; ряд"). */
  let meaningOptions = $state<string[][]>([]);
  let meaningPicked = $state<boolean[]>([]);
  const meaningValue = $derived(joinMeanings(meaningOptions.filter((_, i) => meaningPicked[i])));
  /** Chips only while the field holds their selection: a hand edit hides them and is never overwritten. */
  const showMeanings = $derived(meaningOptions.length > 1 && card.translation === meaningValue);

  /** The lookup just put its translation into the field: offer its meanings as chips, all selected. */
  function offerMeanings() {
    const meanings = splitMeanings(card.translation);
    if (meanings.length < 2) return clearMeanings();
    meaningOptions = meanings;
    meaningPicked = meanings.map(() => true);
    const value = joinMeanings(meanings);
    if (card.translation === auto.translation) auto.translation = value;
    card.translation = value;
  }

  function clearMeanings() {
    meaningOptions = [];
    meaningPicked = [];
  }

  function toggleMeaning(i: number) {
    if (meaningPicked[i] && meaningPicked.filter(Boolean).length === 1) return; // keep at least one
    const wasAuto = card.translation === auto.translation;
    meaningPicked[i] = !meaningPicked[i];
    card.translation = meaningValue;
    // Still the dictionary's text: a re-lookup or the next word may replace it.
    if (wasAuto) auto.translation = card.translation;
  }

  // ---------- Form helpers ----------

  const POS: { id: Pos; label: string }[] = [
    { id: 'noun', label: 'Noun' },
    { id: 'verb', label: 'Verb' },
    { id: 'adj', label: 'Adj' },
    { id: 'other', label: 'Other' },
  ];
  const GENDERS: Gender[] = ['m', 'f', 'n'];

  function toggleGender(g: Gender) {
    card.genders = card.genders.includes(g)
      ? card.genders.filter((x) => x !== g)
      : GENDERS.filter((x) => x === g || card.genders.includes(x));
  }

  function addExample() {
    card.examples.push({ de: '', tr: '' });
  }

  /** Hard-word nudge: open the form and put the cursor where the hook goes. */
  async function writeHook(kind: 'note' | 'example') {
    showDetails = true;
    if (kind === 'example') addExample();
    await tick();
    const el = kind === 'note' ? notesEl : [...document.querySelectorAll<HTMLTextAreaElement>('textarea.ex-de')].at(-1);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.focus();
  }

  async function openDetails(focusTranslation = false) {
    showDetails = true;
    if (focusTranslation) {
      await tick();
      translationEl?.focus();
    }
  }

  // ---------- Save / delete ----------

  function detailsMissing(c: Card): boolean {
    if (!c.translation.trim() || c.pos === 'other') return true;
    if (c.pos === 'noun') return !c.genders.length || !c.plural.trim();
    if (c.pos === 'verb') return !c.praeteritum.trim() || !c.partizip2.trim();
    return false;
  }

  /** Saves the card; returns its id, or 0 when it couldn't be saved (`error` says why). */
  async function save(): Promise<number> {
    applyParsed();
    if (!card.term.trim()) {
      error = 'Enter the German word.';
      germanEl?.focus();
      return 0;
    }
    if (!card.setId) {
      error = 'No set selected for this word.';
      return 0;
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
    c.needsFill = !filled && detailsMissing(c) ? 1 : 0;
    // The full form's Add and a second Return go through here too: never a second card for a word.
    const dup = duplicateOf(c);
    if (dup) {
      error = `“${dup.term}” is already in this set.`;
      return 0;
    }
    const id = await saveCard(c);
    if (isNew) {
      rememberQuickAddSet(c.setId); // shared words (Share.svelte) go to the same set
      setCards = [...setCards, { id, term: c.term.trim(), pos: c.pos, genders: c.genders }];
    }
    return id;
  }

  async function saveAndClose() {
    if (await save()) back(backTo);
  }

  /** Save, list it under "Added", and get ready for the next word — keeping the keyboard up. */
  async function quickAdd() {
    germanEl?.focus(); // inside the tap, so iOS keeps the keyboard open
    const id = await save();
    if (!id) return;
    const word = $state.snapshot(card) as Card;
    added = [
      { id, term: word.term.trim(), pos: word.pos, genders: word.pos === 'noun' ? word.genders : [], translation: word.translation.trim() },
      ...added,
    ];
    lookupCtrl?.abort();
    stopSuggest();
    card = emptyCard(card.setId);
    filled = false;
    auto = { translation: '', examples: '' };
    clearMeanings();
    lookupState = 'idle';
    lemmaNote = '';
    via = null;
    articles = [];
    lastLookedUp = '';
    showDetails = false;
    await tick();
    germanEl?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function changeStatus(known: boolean) {
    if (!card.id) return;
    await setKnown([card.id], known);
    card.known = known ? 1 : 0;
    status = known ? 'known' : 'new';
    showToast(known ? 'Marked as known' : 'Back to learning — it will come up as new');
  }

  async function remove() {
    if (!card.id) return;
    const term = card.term;
    const snapshot = await deleteCard(card.id);
    back(backTo);
    undoToast(`Deleted “${term}”`, snapshot);
  }

  /** Keeps focus in the German field when tapping a button (iOS keyboard stays up). */
  const keepFocus = (e: PointerEvent) => {
    if (focused) e.preventDefault();
  };

  // A new word: the field is ready to type into (keyboard opened by the tap, see lib/ui/keyboard).
  onMount(() => {
    if (isNew) takeKeyboard(germanEl);
  });

  if (givenTerm) void runLookup();
</script>

<svelte:window onpointerup={onWindowPointerEnd} onpointercancel={onWindowPointerEnd} />

{#snippet meaningChips()}
  <div class="meaning-pick" transition:slide={{ duration: dur(180) }}>
    <div class="meaning-chips" role="group" aria-label="Meanings">
      {#each meaningOptions as m, i}
        <button
          type="button"
          class="chip meaning"
          class:active={meaningPicked[i]}
          aria-pressed={meaningPicked[i]}
          onpointerdown={keepFocus}
          onclick={() => toggleMeaning(i)}>{m.join(', ')}</button
        >
      {/each}
    </div>
    <div class="small muted">Tap to keep only the meanings you need</div>
  </div>
{/snippet}

<div class="page">
  <Header title={isNew ? 'Add word' : 'Edit word'} subtitle={setName} {backTo}>
    {#snippet actions()}
      {#if loaded && !missing}
        <button
          class="icon-btn star"
          class:on={card.starred}
          aria-label={card.starred ? 'Unstar' : 'Star'}
          aria-pressed={!!card.starred}
          onpointerdown={keepFocus}
          onclick={() => (card.starred = card.starred ? 0 : 1)}
        >
          <Icon name="star" filled={!!card.starred} />
        </button>
      {/if}
    {/snippet}
  </Header>

  {#if missing}
    <div class="empty">This word no longer exists.</div>
  {:else if !loaded}
    <div class="card"><Skeleton lines={4} /></div>
  {:else}
    <div class="stack">
      <!-- ---------- German ---------- -->
      <div class="field">
        <label for="german">German</label>
        <div class="row">
          <div class="input-wrap">
            <input
              id="german"
              class="input german"
              class:big={isNew}
              bind:this={germanEl}
              bind:value={card.term}
              oninput={onGermanInput}
              onfocus={onGermanFocus}
              onblur={onGermanBlur}
              onkeydown={onGermanKeydown}
              placeholder={isNew ? 'Type a word: Haus, gehen, schön…' : 'der Tisch, gehen, schön…'}
              autocapitalize="off"
              autocomplete="off"
              autocorrect="off"
              spellcheck="false"
              lang="de"
              enterkeyhint={isNew && lookupState === 'done' ? 'done' : 'search'}
            />
            {#if isNew && card.term}
              <button type="button" class="clear" aria-label="Clear" onpointerdown={keepFocus} onclick={clearTerm}>
                <Icon name="x" size={16} />
              </button>
            {/if}
          </div>
          {#if !isNew}
            <button
              type="button"
              class="btn lookup"
              onclick={runLookup}
              disabled={lookupState === 'loading'}
              aria-label="Look up"
            >
              <Icon name="sparkle" size={20} />
              <span>Look up</span>
            </button>
          {/if}
        </div>
        <UmlautBar input={germanEl} />
        {#if suggestions.length && focused}
          <div
            class="list suggestions"
            role="listbox"
            bind:this={suggestEl}
            onfocusout={onSuggestionsFocusout}
            transition:slide={{ duration: dur(150) }}
          >
            {#each suggestions as s}
              <button
                type="button"
                class="list-item"
                role="option"
                aria-selected="false"
                onpointerdown={onSuggestionPointerdown}
                onclick={() => pickSuggestion(s)}
              >
                <span class="title"
                  >{#if s.genders}<Term card={{ term: s.word, pos: 'noun', genders: s.genders }} />{:else}{s.word}{/if}</span
                >
                {#if s.preview}<span class="sub ellipsis">{s.preview}</span>{/if}
              </button>
            {/each}
          </div>
        {/if}
        {#if error}<div class="status small bad">{error}</div>{/if}
        {#if !isNew}
          {#if lookupState === 'loading'}
            <div class="status small muted">Looking up…</div>
          {:else if lookupState === 'error'}
            <div class="status small bad">Couldn’t look up — fill in manually.</div>
          {:else if lookupState === 'notfound'}
            <div class="status small muted">Not found in the dictionary.</div>
          {:else if lookupState === 'done'}
            <div class="status small good">Filled in what was missing.</div>
          {/if}
          {#if lookupState === 'done' && articles.length > 1}
            <div class="article-pick" transition:slide={{ duration: dur(180) }}>
              <div class="small muted">Each article has its own meaning. This word is:</div>
              <ArticleChoices term={card.term} {articles} selected={pickedArticle} trLang={settings.lang} onpick={chooseArticle} />
            </div>
          {/if}
        {/if}
      </div>

      <!-- ---------- Quick add (new words) ---------- -->
      {#if isNew}
        {#if lookupState === 'loading'}
          <div class="card" in:fade={{ duration: dur(150) }}>
            <Skeleton lines={3} />
          </div>
        {:else if lookupState === 'done' || (showDetails && card.term.trim())}
          <div class="card preview" in:fly={{ y: 10, duration: dur(220) }}>
            <div class="p-top">
              <div class="p-term"><Term {card} /></div>
              <SpeakButton text={speakableTerm(card)} />
            </div>
            {#if articles.length > 1 && lookupState === 'done'}
              <div class="article-pick">
                <ArticleChoices
                  term={card.term}
                  {articles}
                  selected={pickedArticle}
                  trLang={settings.lang}
                  onpick={chooseArticle}
                  onadd={(a) => void addArticle(a)}
                  isAdded={articleInSet}
                  onpointerdown={keepFocus}
                />
                <div class="small muted">Each article has its own meaning — tap one, or add it with +</div>
              </div>
            {:else}
              {#if forms}<div class="p-forms">{forms}</div>{/if}
              {#if card.translation}
                <div class="p-tr">{card.translation}</div>
              {:else}
                <div class="p-tr muted">No translation yet</div>
              {/if}
            {/if}
            {#if showMeanings && !showDetails}{@render meaningChips()}{/if}
            {#if firstExample}
              <div class="p-ex">
                <div lang="de">{firstExample.de}</div>
                {#if firstExample.tr}<div class="muted">{firstExample.tr}</div>{/if}
              </div>
            {/if}
            {#if lemmaNote || via}
              <div class="row">
                {#if lemmaNote}<span class="chip">{lemmaNote}</span>{/if}
                {#if via}<span class="via muted">via {PROVIDER_LABELS[via]}</span>{/if}
              </div>
            {/if}
          </div>
        {:else if lookupState === 'notfound' || lookupState === 'error' || lookupState === 'offline'}
          <div class="card note" in:fade={{ duration: dur(150) }}>
            <Icon name={lookupState === 'offline' ? 'refresh' : 'search'} size={20} />
            <div class="small">
              {#if lookupState === 'notfound'}
                Couldn’t find “{card.term.trim()}” in the dictionary. You can add it anyway with your own translation.
              {:else if lookupState === 'error'}
                The dictionary didn’t answer. Try again, or add the word anyway.
              {:else}
                You’re offline and “{card.term.trim()}” isn’t in the offline dictionary. Add it now — details are filled in once you’re online.
              {/if}
            </div>
          </div>
        {:else if !card.term.trim()}
          <div class="hint-card small muted" in:fade={{ duration: dur(150) }}>
            {#if added.length}
              Next word?
            {:else}
              Type a German word — the article, plural, translation and an example are filled in for you.
            {/if}
          </div>
        {/if}

        {#if duplicate}
          <div class="stack quick-actions" in:fade={{ duration: dur(150) }}>
            <div class="card note dup">
              <Icon name="check" size={20} />
              <div class="grow">“<span lang="de"><Term card={duplicate} /></span>” is already in this set</div>
              <button type="button" class="btn small-btn" onclick={() => go(`/card/${duplicate.id}`)}>Open</button>
            </div>
            {#if lookupState === 'idle' && !showDetails}
              <!-- Only the typed text matched: the dictionary may know another article (die See). -->
              <button type="button" class="btn btn-ghost btn-block" onpointerdown={keepFocus} onclick={runLookup}>
                <Icon name="search" size={18} /> Look up
              </button>
            {/if}
          </div>
        {:else if !showDetails && lookupState !== 'loading' && card.term.trim()}
          <div class="stack quick-actions" in:fade={{ duration: dur(150) }}>
            {#if lookupState === 'idle'}
              <button type="button" class="btn btn-primary btn-lg btn-block" onpointerdown={keepFocus} onclick={runLookup}>
                <Icon name="search" size={20} /> Look up
              </button>
              <button type="button" class="btn btn-ghost btn-block" onclick={() => openDetails()}>Fill in myself</button>
            {:else}
              {#if lookupState === 'error'}
                <button type="button" class="btn btn-block" onpointerdown={keepFocus} onclick={runLookup}><Icon name="refresh" size={20} /> Try again</button>
              {/if}
              <button type="button" class="btn btn-primary btn-lg btn-block add" onpointerdown={keepFocus} onclick={quickAdd}>
                <Icon name="check" size={22} />
                {lookupState === 'done' ? (articles.length > 1 && pickedArticle ? `Add ${displayTerm(card)}` : 'Add') : 'Add anyway'}
              </button>
              <button type="button" class="btn btn-ghost btn-block" onclick={() => openDetails(lookupState === 'notfound')}>
                <Icon name="edit" size={18} /> {lookupState === 'notfound' ? 'Add a translation' : 'Edit details'}
              </button>
            {/if}
          </div>
        {/if}
      {/if}

      <!-- ---------- Status (existing words) ---------- -->
      {#if !isNew}
        <div class="card status-row">
          <span class="pill st-{status}">{STATUS_LABELS[status]}</span>
          <span class="spacer"></span>
          {#if status !== 'known'}
            <button type="button" class="btn small-btn" onclick={() => changeStatus(true)}><Icon name="check" size={18} /> Mark known</button>
          {/if}
          {#if status !== 'new'}
            <button type="button" class="btn small-btn" onclick={() => changeStatus(false)}><Icon name="refresh" size={18} /> Not learned</button>
          {/if}
        </div>
        {#if hard}
          <div class="card hard-banner" in:fade={{ duration: dur(150) }}>
            <div class="row hard-head"><Icon name="flame" size={20} filled /> Missed {misses} times</div>
            <p class="small">
              Give this word a memory hook: a mnemonic, a similar-sounding Russian word, or your own sentence. Your note
              is shown every time you study it.
            </p>
            <div class="row hard-actions">
              <button type="button" class="btn small-btn" onclick={() => writeHook('note')}><Icon name="edit" size={18} /> Write a note</button>
              <button type="button" class="btn small-btn" onclick={() => writeHook('example')}><Icon name="plus" size={18} /> My own example</button>
            </div>
          </div>
        {/if}
      {/if}

      <!-- ---------- Full form ---------- -->
      {#if showDetails}
        <form
          class="stack details"
          transition:slide={{ duration: dur(260) }}
          onsubmit={(e) => (e.preventDefault(), isNew ? quickAdd() : saveAndClose())}
        >
          <div class="field">
            <span class="label">Part of speech</span>
            <div class="segmented">
              {#each POS as p}
                <button type="button" class:active={card.pos === p.id} onclick={() => (card.pos = p.id)}>{p.label}</button>
              {/each}
            </div>
          </div>

          {#if card.pos === 'noun'}
            <div class="field" transition:slide={{ duration: dur(180) }}>
              <span class="label">Article</span>
              <div class="genders">
                {#each GENDERS as g}
                  <button
                    type="button"
                    class="gender g-{g}"
                    class:active={card.genders.includes(g)}
                    aria-pressed={card.genders.includes(g)}
                    onclick={() => toggleGender(g)}>{ARTICLE[g]}</button
                  >
                {/each}
              </div>
            </div>
            <div class="field">
              <label for="plural">Plural <span class="hint">(without “die”)</span></label>
              <input
                id="plural"
                class="input"
                bind:value={card.plural}
                placeholder="Häuser"
                autocapitalize="off"
                autocomplete="off"
                autocorrect="off"
                spellcheck="false"
                lang="de"
              />
            </div>
          {:else if card.pos === 'verb'}
            <div class="field">
              <label for="praet">Präteritum</label>
              <input id="praet" class="input" bind:value={card.praeteritum} placeholder="ging" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" lang="de" />
            </div>
            <div class="field">
              <label for="p2">Partizip II</label>
              <input id="p2" class="input" bind:value={card.partizip2} placeholder="gegangen" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" lang="de" />
            </div>
            <div class="field">
              <span class="label">Perfekt with</span>
              <div class="segmented">
                <button type="button" class:active={card.auxiliary === 'haben'} onclick={() => (card.auxiliary = card.auxiliary === 'haben' ? '' : 'haben')}>haben</button>
                <button type="button" class:active={card.auxiliary === 'sein'} onclick={() => (card.auxiliary = card.auxiliary === 'sein' ? '' : 'sein')}>sein</button>
              </div>
            </div>
          {/if}

          <div class="field">
            <label for="tr">Translation</label>
            <input id="tr" class="input" bind:this={translationEl} bind:value={card.translation} placeholder="Translation ({lang})" lang={settings.lang} />
            {#if showMeanings}{@render meaningChips()}{/if}
          </div>

          <div class="field">
            <span class="label">Examples</span>
            {#if card.examples.length}
              <div class="list examples">
                {#each card.examples as ex, i}
                  <div class="example" transition:slide={{ duration: dur(180) }}>
                    <div class="grow stack-sm">
                      <textarea
                        class="input ex-de"
                        rows="2"
                        bind:value={ex.de}
                        placeholder="German sentence"
                        autocapitalize="sentences"
                        autocomplete="off"
                        {...{ autocorrect: 'off' }}
                        spellcheck="false"
                        lang="de"
                      ></textarea>
                      <input class="input" bind:value={ex.tr} placeholder="Translation ({lang})" lang={settings.lang} />
                    </div>
                    <div class="ex-actions">
                      <SpeakButton text={ex.de} />
                      <button type="button" class="icon-btn del" aria-label="Delete example" onclick={() => card.examples.splice(i, 1)}>
                        <Icon name="trash" size={20} />
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
            <button type="button" class="btn btn-ghost add-ex" onclick={addExample}><Icon name="plus" size={18} /> Add example</button>
          </div>

          <div class="field">
            <label for="notes">Notes</label>
            <textarea
              id="notes"
              class="input"
              rows="3"
              bind:this={notesEl}
              bind:value={card.notes}
              placeholder={hard ? `Memory hook: “${card.term}” sounds like… / think of…` : 'Anything to remember'}
            ></textarea>
          </div>

          <div class="stack buttons">
            {#if isNew}
              <button type="submit" class="btn btn-primary btn-block btn-lg"><Icon name="check" /> Add</button>
              <button type="button" class="btn btn-block" onclick={saveAndClose}>Add and close</button>
            {:else}
              <button type="submit" class="btn btn-primary btn-block btn-lg"><Icon name="check" /> Save</button>
              <button type="button" class="btn btn-danger btn-block" onclick={remove}><Icon name="trash" /> Delete word</button>
            {/if}
          </div>
        </form>
      {/if}

      <!-- ---------- Added on this screen (new words) ---------- -->
      {#if isNew && added.length}
        <section class="added" transition:slide={{ duration: dur(200) }}>
          <h2 class="section-title">Added <span>{added.length}</span></h2>
          <div class="list" role="list">
            {#each added as w (w.id)}
              <div class="list-item" role="listitem" in:slide={{ duration: dur(220) }}>
                <span class="title" lang="de"><Term card={w} /></span>
                {#if w.translation}<span class="sub ellipsis" lang={settings.lang}>{w.translation}</span>{/if}
              </div>
            {/each}
          </div>
        </section>
      {/if}
    </div>
  {/if}
</div>

<style>
  .grow {
    flex: 1;
    min-width: 0;
  }
  .input-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  .german {
    font-size: 17px;
  }
  .german.big {
    min-height: 56px;
    font-family: var(--font-display);
    font-size: 21px;
    font-weight: 700;
    padding-right: 44px;
  }
  .clear {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--muted);
    cursor: pointer;
  }
  .lookup {
    flex-shrink: 0;
    color: var(--accent);
    padding: 10px 12px;
  }
  .status {
    margin-left: 4px;
  }
  .suggestions .list-item {
    min-height: 46px;
    padding: 8px 14px;
  }
  .ellipsis {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .suggestions .ellipsis {
    text-align: right;
    color: var(--text-2);
  }

  /* ---------- Quick add ---------- */
  .preview {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 18px 12px 18px 18px;
    border-radius: var(--radius-lg);
    background: var(--grad-feature);
  }
  .p-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .p-term {
    flex: 1;
    min-width: 0;
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 800;
    overflow-wrap: anywhere;
    line-height: 1.2;
  }
  .p-forms {
    color: var(--muted);
  }
  .p-tr {
    font-size: 19px;
    color: var(--text-2);
    overflow-wrap: break-word;
  }
  .p-ex {
    margin-top: 6px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--inset-bg);
    box-shadow: inset 0 0 0 1px var(--hairline);
    font-family: var(--font-read);
    font-style: italic;
    font-size: 16px;
  }
  .note {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .note > :global(svg) {
    color: var(--muted);
    flex-shrink: 0;
    margin-top: 1px;
  }
  .dup {
    align-items: center;
  }
  .dup > :global(svg) {
    color: var(--good);
    margin-top: 0;
  }
  .dup .grow {
    overflow-wrap: anywhere;
  }
  .added .list-item {
    min-height: 48px;
    padding: 8px 16px;
    cursor: default;
  }
  .added .list-item:active {
    background: none;
  }
  .added .title {
    flex-shrink: 0;
    max-width: 60%;
    overflow-wrap: anywhere;
  }
  .added .ellipsis {
    text-align: right;
  }
  .hint-card {
    padding: 4px 6px;
    text-align: center;
  }
  .add {
    font-size: 20px;
  }

  /* ---------- Status ---------- */
  .hard-banner {
    background: color-mix(in srgb, var(--warn) 8%, var(--surface));
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--warn) 45%, transparent);
  }
  .hard-head {
    color: var(--warn);
    font-family: var(--font-display);
    font-weight: 800;
  }
  .hard-banner p {
    margin: 6px 0 10px;
    color: var(--muted);
  }
  .hard-actions {
    flex-wrap: wrap;
  }
  .status-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px 12px;
  }
  .pill {
    padding: 4px 12px;
    border-radius: 999px;
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 800;
    background: var(--surface-2);
  }
  .pill.st-learning {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .pill.st-learned,
  .pill.st-known {
    color: var(--good);
    background: color-mix(in srgb, var(--good) 14%, transparent);
  }
  .small-btn {
    min-height: 38px;
    padding: 6px 12px;
    font-size: 15px;
  }

  /* ---------- Details ---------- */
  .hint {
    font-weight: 400;
  }
  .genders {
    display: flex;
    gap: 8px;
  }
  .gender {
    flex: 1;
    min-height: 48px;
    border-radius: 14px;
    border: 0;
    background: color-mix(in srgb, currentColor 10%, var(--surface));
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, currentColor 30%, transparent);
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 900;
    cursor: pointer;
    opacity: 0.6;
    transition:
      opacity var(--dur-fast) var(--ease),
      background-color var(--dur-fast) var(--ease);
  }
  .gender.active {
    opacity: 1;
  }
  .gender.g-m.active,
  .gender.g-f.active,
  .gender.g-n.active {
    color: var(--on-tone);
    box-shadow: none;
  }
  .gender.g-m.active {
    background: var(--der);
  }
  .gender.g-f.active {
    background: var(--die);
  }
  .gender.g-n.active {
    background: var(--das);
  }
  .examples {
    padding: 0;
  }
  .example {
    display: flex;
    gap: 4px;
    padding: 10px 4px 10px 10px;
  }
  .example + .example {
    border-top: 1px solid var(--hairline);
  }
  .stack-sm {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ex-de {
    min-height: 0;
  }
  .ex-actions {
    display: flex;
    flex-direction: column;
  }
  .del {
    color: var(--bad);
  }
  .add-ex {
    align-self: flex-start;
  }
  .buttons {
    margin-top: 8px;
  }
  .star {
    color: var(--muted);
  }
  .star.on {
    color: var(--accent);
  }
  .via {
    font-size: 12px;
  }

  /* ---------- Articles with different meanings ---------- */
  .article-pick {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 4px 0 2px;
  }

  /* ---------- Meanings ---------- */
  .meaning-pick {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
  }
  .meaning-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .meaning {
    min-height: 36px;
    border: 0;
    box-shadow: inset 0 0 0 1.5px var(--border);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease),
      box-shadow var(--dur-fast) var(--ease);
  }
  .meaning.active {
    box-shadow: inset 0 0 0 1.5px var(--accent);
    background: var(--accent-soft);
    color: var(--text);
  }
</style>
