<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, slide } from 'svelte/transition';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Term from '../components/Term.svelte';
  import Sheet from '../components/Sheet.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import UmlautBar from '../components/UmlautBar.svelte';
  import WordDetails from '../components/search/WordDetails.svelte';
  import SetPicker from '../components/search/SetPicker.svelte';
  import { go } from '../lib/router.svelte';
  import { dur } from '../lib/motion';
  import { online } from '../lib/online.svelte';
  import { settings } from '../lib/settings.svelte';
  import { addSet } from '../lib/db/repo';
  import type { LexEntry } from '../lib/dict/types';
  import { queryScript } from '../lib/dict/reverse';
  import { parseGermanInput } from '../lib/german/parseTerm';
  import { rememberQuickAddSet } from '../lib/share';
  import { promptText, showToast } from '../lib/ui/dialogs.svelte';
  import type { Gender } from '../lib/types';
  import { addRecent, clearRecent, loadRecent } from '../lib/search/recent';
  import { addWordToSet, type SetChoice } from '../lib/search/addToSet';
  import { emptyGroups, MIN_QUERY, rowLabel, searchWords, type SearchGroups, type SearchRow } from '../lib/search/results';
  import type { WordFields } from '../lib/search/wordInfo';

  /**
   * Quick word search (#/search): type German (any form, with or without an article), English
   * or Russian, open a word's details, and optionally add it to one of your sets.
   */

  let query = $state('');
  let inputEl = $state<HTMLInputElement>();
  let focused = $state(false);
  let recent = $state(loadRecent());

  // ---------- Results ----------

  let groups = $state<SearchGroups>(emptyGroups());
  /** The query `groups` belong to. */
  let resultsFor = $state('');
  let searching = $state(false);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchCtrl: AbortController | undefined;
  /** The running search, so Return can wait for it. */
  let inflight: Promise<SearchGroups> | null = null;
  const SEARCH_DELAY_MS = 250;

  const norm = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ');
  const q = $derived(norm(query));
  const script = $derived(queryScript(q));
  const hasResults = $derived(!!(groups.german.length || groups.english.length || groups.russian.length));
  const current = $derived(resultsFor === q);

  function stopSearch() {
    clearTimeout(searchTimer);
    searchCtrl?.abort();
    searching = false;
  }

  function runSearch(text: string): Promise<SearchGroups> {
    stopSearch();
    const ctrl = new AbortController();
    searchCtrl = ctrl;
    searching = true;
    resultsFor = text;
    groups = emptyGroups();
    const p = searchWords(text, settings.lang, ctrl.signal, (g) => (groups = g)).finally(() => {
      if (!ctrl.signal.aborted) searching = false;
      if (inflight === p) inflight = null;
    });
    inflight = p;
    return p;
  }

  function onInput() {
    opened = null;
    stopSearch();
    const text = norm(query);
    if (text.length < MIN_QUERY) {
      groups = emptyGroups();
      resultsFor = text;
      return;
    }
    searchTimer = setTimeout(() => void runSearch(text), SEARCH_DELAY_MS);
  }

  /** Return: open the best result (the typed word itself when there is none). */
  async function submit() {
    const text = q;
    if (!text || opened) return;
    // Rows already shown for this text are used right away; otherwise wait for the search.
    let g = groups;
    if (resultsFor !== text || !inflight) {
      if (resultsFor !== text) g = await runSearch(text);
    } else if (!hasResults) g = await inflight;
    if (norm(query) !== text || opened) return; // typed on (or opened a row) meanwhile
    const first = g.german[0] ?? g.english[0] ?? g.russian[0];
    if (first) openRow(first);
    else if (queryScript(text) === 'latin') openWord(text);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void submit();
  }

  function clearQuery() {
    query = '';
    opened = null;
    stopSearch();
    groups = emptyGroups();
    resultsFor = '';
    inputEl?.focus();
  }

  // ---------- Details ----------

  let opened = $state<{ id: number; word: string; want: Gender | null; entry: LexEntry | null } | null>(null);
  let openId = 0;

  function show(word: string, want: Gender | null, entry: LexEntry | null) {
    stopSearch();
    opened = { id: ++openId, word, want, entry };
    inputEl?.blur(); // keyboard down: the details are below the field
    window.scrollTo({ top: 0 });
  }

  function openRow(row: SearchRow) {
    query = rowLabel(row);
    show(row.term, row.gender ?? null, row.entry ?? null);
  }

  /** Typed text or a recent search ("die See" selects that article). */
  function openWord(text: string) {
    query = text;
    const p = parseGermanInput(text);
    show(text, p.genders.length === 1 ? p.genders[0] : null, null);
  }

  function onResolved(label: string) {
    recent = addRecent(label);
  }

  function forgetRecent() {
    clearRecent();
    recent = [];
  }

  /** A recent entry ("die See", "gehen") as a term for <Term>. */
  function recentTerm(label: string) {
    const p = parseGermanInput(label);
    return p.genders.length ? { term: p.term, pos: 'noun' as const, genders: p.genders } : { term: label, pos: 'other' as const, genders: [] };
  }

  // ---------- Add to set ----------

  let pickerOpen = $state(false);
  /** The word being added: plain data (not a deep proxy), so IndexedDB can store it. */
  let pending = $state.raw<{ fields: WordFields; label: string } | null>(null);
  let adding = $state(false);

  function startAdd(fields: WordFields, label: string) {
    pending = { fields: $state.snapshot(fields) as WordFields, label };
    pickerOpen = true;
  }

  async function addTo(setId: number, setName: string) {
    if (!pending || adding) return;
    const { fields, label } = pending;
    adding = true;
    try {
      const r = await addWordToSet(setId, fields);
      rememberQuickAddSet(setId);
      pickerOpen = false;
      const split = fields.pos === 'noun' && (fields.genders?.length ?? 0) === 1 && label.includes(' ');
      showToast(
        r.created ? (split ? `Added ${label} to «${setName}»` : `Added to «${setName}»`) : `${label} is already in «${setName}»`,
        { actionLabel: 'Open set', onAction: () => go(`/set/${setId}`) },
      );
    } catch (e) {
      showToast(`Couldn’t add the word: ${(e as Error).message}`);
    } finally {
      adding = false;
    }
  }

  function pickSet(s: SetChoice) {
    void addTo(s.id, s.name);
  }

  async function newSet() {
    if (!pending) return;
    pickerOpen = false;
    const name = await promptText({ title: 'New set', placeholder: 'e.g. Food, Travel, Chapter 3', confirmLabel: 'Create' });
    if (!name) return;
    try {
      await addTo(await addSet(name), name);
    } catch (e) {
      showToast(`Couldn’t create the set: ${(e as Error).message}`);
    }
  }

  // ---------- Focus ----------

  /** Keeps focus in the field when tapping its buttons (iOS keyboard stays up). */
  const keepFocus = (e: PointerEvent) => {
    if (focused) e.preventDefault();
  };

  onMount(() => {
    inputEl?.focus();
    return () => stopSearch();
  });
</script>

{#snippet resultGroup(title: string, rows: SearchRow[], hintLang: string)}
  <section class="group" transition:slide={{ duration: dur(150) }}>
    <h2 class="section-title" lang="en">{title}</h2>
    <div class="list">
      {#each rows as r (r.key)}
        <button type="button" class="list-item result" onclick={() => openRow(r)}>
          <span class="grow">
            <span class="title" lang="de"><Term card={{ term: r.term, pos: r.pos, genders: r.gender ? [r.gender] : r.genders }} /></span>
            {#if r.hint || r.form}
              <span class="sub ellipsis" lang={hintLang}
                >{#if r.form}<span lang="de">{r.form} → {r.term}</span>{#if r.hint}{' · '}{/if}{/if}{r.hint}</span
              >
            {/if}
          </span>
          {#if r.entry?.level}<span class="level">{r.entry.level}</span>{/if}
          <Icon name="chevron" size={18} />
        </button>
      {/each}
    </div>
  </section>
{/snippet}

<div class="page">
  <Header title="Search" backTo="/" />

  <div class="field-box">
    <div class="input-wrap">
      <span class="lead" aria-hidden="true"><Icon name="search" size={20} /></span>
      <input
        class="input search"
        type="search"
        bind:this={inputEl}
        bind:value={query}
        oninput={onInput}
        onfocus={() => (focused = true)}
        onblur={() => (focused = false)}
        onkeydown={onKeydown}
        placeholder="Haus, ging, house, дом…"
        aria-label="Search for a word"
        autocapitalize="off"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        enterkeyhint="search"
      />
      {#if query}
        <button type="button" class="clear" aria-label="Clear" onpointerdown={keepFocus} onclick={clearQuery}>
          <Icon name="x" size={16} />
        </button>
      {/if}
    </div>
    <UmlautBar input={inputEl} />
  </div>

  {#if opened}
    {#key opened.id}
      <WordDetails word={opened.word} want={opened.want} entry={opened.entry} onadd={startAdd} onresolved={onResolved} />
    {/key}
  {:else if q.length < MIN_QUERY}
    {#if recent.length}
      <section class="group" in:fade={{ duration: dur(150) }}>
        <h2 class="section-title" lang="en">
          Recent
          <button type="button" class="link" onclick={forgetRecent}>Clear</button>
        </h2>
        <div class="list">
          {#each recent as w (w)}
            <button type="button" class="list-item result" onclick={() => openWord(w)}>
              <Icon name="refresh" size={18} />
              <span class="grow title" lang="de"><Term card={recentTerm(w)} /></span>
              <Icon name="chevron" size={18} />
            </button>
          {/each}
        </div>
      </section>
    {:else}
      <p class="hint small muted center" lang="en" in:fade={{ duration: dur(150) }}>
        Type a German word in any form — <span lang="de">ging, Häuser, die See</span> — or an English or Russian word to find
        it in German.
      </p>
    {/if}
  {:else}
    {#if groups.german.length}{@render resultGroup('German', groups.german, settings.lang)}{/if}
    {#if groups.english.length}{@render resultGroup('From English', groups.english, 'en')}{/if}
    {#if groups.russian.length}{@render resultGroup('From Russian', groups.russian, 'ru')}{/if}
    {#if !hasResults}
      {#if searching || !current}
        <div class="card group"><Skeleton lines={3} /></div>
      {:else}
        <div class="card note group" lang="en" in:fade={{ duration: dur(150) }}>
          <Icon name="search" size={20} />
          <div class="small">
            {#if script === 'ru'}
              No German words found for “{q}”.
              {#if !online.value}The Russian index loads once you’re online.{/if}
            {:else}
              Nothing in the dictionary starts with “{q}”.
              {#if !online.value}You’re offline — only the offline dictionary is searched.{/if}
            {/if}
          </div>
        </div>
        {#if script === 'latin'}
          <button type="button" class="btn btn-block group" onclick={() => openWord(q)}>
            <Icon name="search" size={20} /> <span class="ellipsis">Look up “<span lang="de">{q}</span>”</span>
          </button>
        {/if}
      {/if}
    {/if}
  {/if}
</div>

<Sheet bind:open={pickerOpen} title={pending ? `Add “${pending.label}” to…` : 'Add to set'}>
  {#if pending}
    <SetPicker fields={pending.fields} busy={adding} onpick={pickSet} onnew={() => void newSet()} />
  {/if}
</Sheet>

<style>
  .field-box {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .input-wrap {
    position: relative;
  }
  .lead {
    position: absolute;
    left: 14px;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    color: var(--muted);
    pointer-events: none;
  }
  .search {
    min-height: 54px;
    padding-left: 44px;
    padding-right: 44px;
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 700;
    -webkit-appearance: none;
    appearance: none;
  }
  .search::-webkit-search-cancel-button,
  .search::-webkit-search-decoration {
    -webkit-appearance: none;
    appearance: none;
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
  .group {
    margin-top: 18px;
  }
  .page > :global(.details) {
    margin-top: 16px;
  }
  .result {
    min-height: 52px;
    padding: 8px 12px 8px 16px;
  }
  .result > :global(svg) {
    color: var(--muted);
    flex-shrink: 0;
  }
  .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .title {
    font-size: 17px;
  }
  .ellipsis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .level {
    flex-shrink: 0;
    padding: 2px 7px;
    border-radius: 999px;
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 900;
    color: var(--muted);
    background: var(--surface-2);
  }
  .link {
    border: 0;
    background: none;
    padding: 4px 0 4px 8px;
    color: var(--accent);
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    cursor: pointer;
  }
  .hint {
    margin: 22px 12px 0;
    line-height: 1.5;
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
</style>
