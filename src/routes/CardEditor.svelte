<script lang="ts">
  import { tick } from 'svelte';
  import { fade, fly, slide } from 'svelte/transition';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Term from '../components/Term.svelte';
  import SpeakButton from '../components/SpeakButton.svelte';
  import UmlautBar from '../components/UmlautBar.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { back, route } from '../lib/router.svelte';
  import { dur } from '../lib/motion';
  import { online } from '../lib/online.svelte';
  import { settings } from '../lib/settings.svelte';
  import { db } from '../lib/db/schema';
  import { deleteCard, emptyCard, saveCard } from '../lib/db/repo';
  import { isHard, setKnown, statusOf, STATUS_LABELS, type WordStatus } from '../lib/progress';
  import { parseGermanInput } from '../lib/german/parseTerm';
  import { joinMeanings, splitMeanings } from '../lib/german/meanings';
  import { ARTICLE, displayPlural, displayVerbForms, speakableTerm } from '../lib/german/articles';
  import { lookupWordWithSource, mergeIntoCard, suggest, type Suggestion } from '../lib/lookup/lookup';
  import { PROVIDER_LABELS, type ProviderId } from '../lib/sources/chain';
  import { showToast, undoToast } from '../lib/ui/dialogs.svelte';
  import type { Card, Gender, LookupResult, Pos } from '../lib/types';

  /*
   * New word  → "Quick add": type → dictionary preview → ✓ Add (keyboard stays up for the next
   *             word). "Edit details" slides the full form open.
   * Edit word → the full form, a status row (Mark known / Not learned) and Delete with Undo.
   */
  const isNew = route.parts[1] === 'new';
  const cardId = isNew ? 0 : Number(route.parts[1]);

  let card = $state<Card>(emptyCard(Number(route.query.get('set')) || 0));
  let loaded = $state(isNew);
  let missing = $state(false);
  let setName = $state('');
  let status = $state<WordStatus>('new');
  let showDetails = $state(!isNew);
  let addedCount = $state(0);

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
  } else loadSetName();

  async function loadSetName() {
    if (!card.setId) return;
    const set = await db.sets.get(card.setId);
    setName = set ? set.topic || set.name : '';
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
    try {
      // Offline dictionary first, then online sources (see lib/sources); works offline for common words.
      const { result: r, via: from } = await lookupWordWithSource(word, settings.lang, ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (!r) {
        lookupState = online.value ? 'notfound' : 'offline';
        return;
      }
      via = from;
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

  async function save(): Promise<boolean> {
    applyParsed();
    if (!card.term.trim()) {
      error = 'Enter the German word.';
      germanEl?.focus();
      return false;
    }
    if (!card.setId) {
      error = 'No set selected for this word.';
      return false;
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
    await saveCard(c);
    return true;
  }

  async function saveAndClose() {
    if (await save()) back(backTo);
  }

  /** Save, say so, and get ready for the next word — keeping the keyboard up. */
  async function quickAdd() {
    germanEl?.focus(); // inside the tap, so iOS keeps the keyboard open
    const term = card.term.trim();
    if (!(await save())) return;
    lookupCtrl?.abort();
    stopSuggest();
    card = emptyCard(card.setId);
    filled = false;
    auto = { translation: '', examples: '' };
    clearMeanings();
    lookupState = 'idle';
    lemmaNote = '';
    via = null;
    lastLookedUp = '';
    showDetails = false;
    addedCount++;
    showToast(`Added “${term}”`);
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
                <span class="title">{s.word}</span>
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
            {#if forms}<div class="p-forms">{forms}</div>{/if}
            {#if card.translation}
              <div class="p-tr">{card.translation}</div>
            {:else}
              <div class="p-tr muted">No translation yet</div>
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
            {#if addedCount}
              <strong class="good">{addedCount} {addedCount === 1 ? 'word' : 'words'} added.</strong> Next one?
            {:else}
              Type a German word — the article, plural, translation and an example are filled in for you.
            {/if}
          </div>
        {/if}

        {#if !showDetails && lookupState !== 'loading' && card.term.trim()}
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
                {lookupState === 'done' ? 'Add' : 'Add anyway'}
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
                autocorrect="off"
                spellcheck="false"
                lang="de"
              />
            </div>
          {:else if card.pos === 'verb'}
            <div class="field">
              <label for="praet">Präteritum</label>
              <input id="praet" class="input" bind:value={card.praeteritum} placeholder="ging" autocapitalize="off" autocorrect="off" spellcheck="false" lang="de" />
            </div>
            <div class="field">
              <label for="p2">Partizip II</label>
              <input id="p2" class="input" bind:value={card.partizip2} placeholder="gegangen" autocapitalize="off" autocorrect="off" spellcheck="false" lang="de" />
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
    min-height: 54px;
    font-size: 20px;
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
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ---------- Quick add ---------- */
  .preview {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 16px 12px 16px 18px;
  }
  .p-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .p-term {
    flex: 1;
    min-width: 0;
    font-size: 28px;
    font-weight: 700;
    overflow-wrap: anywhere;
    line-height: 1.2;
  }
  .p-forms {
    color: var(--muted);
  }
  .p-tr {
    font-size: 19px;
  }
  .p-ex {
    margin-top: 4px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font-size: 15px;
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
  .hint-card {
    padding: 4px 6px;
    text-align: center;
  }
  .add {
    font-size: 20px;
  }

  /* ---------- Status ---------- */
  .hard-banner {
    border: 1.5px solid color-mix(in srgb, var(--warn) 60%, transparent);
  }
  .hard-head {
    color: var(--warn);
    font-weight: 700;
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
    font-size: 14px;
    font-weight: 700;
    background: var(--surface-2);
  }
  .pill.st-learning {
    color: var(--accent);
  }
  .pill.st-learned {
    color: var(--good);
  }
  .pill.st-known {
    color: var(--good);
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
    min-height: 46px;
    border-radius: var(--radius-sm);
    border: 2px solid currentColor;
    background: var(--surface);
    font-size: 18px;
    font-weight: 700;
    cursor: pointer;
    opacity: 0.55;
  }
  .gender.active {
    opacity: 1;
  }
  .gender.g-m.active,
  .gender.g-f.active,
  .gender.g-n.active {
    color: var(--surface);
  }
  .gender.g-m.active {
    background: var(--der);
    border-color: var(--der);
  }
  .gender.g-f.active {
    background: var(--die);
    border-color: var(--die);
  }
  .gender.g-n.active {
    background: var(--das);
    border-color: var(--das);
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
    border-top: 1px solid var(--border);
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
    color: var(--warn);
  }
  .via {
    font-size: 12px;
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
    min-height: 34px;
    border: 1.5px solid var(--border);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
  }
  .meaning.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--text);
  }
</style>
