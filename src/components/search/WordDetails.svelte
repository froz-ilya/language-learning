<script lang="ts">
  import { liveQuery } from 'dexie';
  import { fade } from 'svelte/transition';
  import Icon from '../Icon.svelte';
  import Term from '../Term.svelte';
  import Meanings from '../Meanings.svelte';
  import SpeakButton from '../SpeakButton.svelte';
  import Skeleton from '../Skeleton.svelte';
  import ArticleChoices from '../ArticleChoices.svelte';
  import { go } from '../../lib/router.svelte';
  import { dur } from '../../lib/motion';
  import { online } from '../../lib/online.svelte';
  import { settings } from '../../lib/settings.svelte';
  import type { LexEntry } from '../../lib/dict/types';
  import { ARTICLE, displayTerm, speakableTerm } from '../../lib/german/articles';
  import { parseGermanInput } from '../../lib/german/parseTerm';
  import { STATUS_LABELS } from '../../lib/progress';
  import type { ArticleVariant, Gender } from '../../lib/types';
  import { ownedCards, type OwnedCard } from '../../lib/search/addToSet';
  import {
    articleCardFields,
    articleRowsOf,
    displayOf,
    formsOf,
    initialWordLookup,
    loadWordInfo,
    mergeInfo,
    type WordFields,
  } from '../../lib/search/wordInfo';

  /**
   * A looked-up word on the search screen: term with article, forms, meanings, an example,
   * pronunciation, whether the user has it (and how well), and "Add to set". Uses the same
   * lookup as the reader's word sheet (lib/search/wordInfo).
   */
  let {
    word,
    want = null,
    entry = null,
    onadd,
    onresolved,
  }: {
    /** What to look up: a lemma, an inflected form ("ging"), or with an article ("die See"). */
    word: string;
    /** Article to select for a noun whose articles differ in meaning. */
    want?: Gender | null;
    /** Offline entry the result row came from (used when the lookup finds nothing). */
    entry?: LexEntry | null;
    /** "Add to set" (or + on an article row): the card fields and how to name the word. */
    onadd: (fields: WordFields, label: string) => void;
    /** The word was found: its name ("das Haus", "die See") for recent searches. */
    onresolved?: (label: string) => void;
  } = $props();

  const lang = $derived(settings.lang);
  let lookup = $state(initialWordLookup());

  // Offline dictionary first, online only when needed; runs again when the connection comes back.
  $effect(() => {
    void online.value;
    const ctrl = new AbortController();
    void loadWordInfo(word, {
      entry,
      lang: settings.lang,
      isOnline: () => online.value,
      signal: ctrl.signal,
      onchange: (s) => (lookup = s),
    });
    return () => ctrl.abort();
  });

  const info = $derived(mergeInfo(lookup.local, lookup.remote, lang));
  const display = $derived(displayOf(info));
  const articleRows = $derived(articleRowsOf(lookup.local, lookup.localArticles, lookup.remote, lang));
  const split = $derived(articleRows.length > 1 && !!display);
  const lookingUp = $derived(!lookup.localDone || lookup.remoteState === 'loading');
  const translation = $derived(info?.translation?.trim() ?? '');

  // ---------- Article (nouns whose articles differ in meaning) ----------

  let picked = $state<Gender | null>(null);
  /** The asked-for article, else the one the typed form belongs to ("Gehälter" → das Gehalt), else the most common. */
  const selected = $derived.by((): Gender | null => {
    if (!split) return null;
    const has = (g: Gender | null | undefined) => !!g && articleRows.some((a) => a.genders[0] === g);
    for (const g of [picked, want, lookup.form ? lookup.local?.genders[0] : null]) if (has(g)) return g!;
    return articleRows[0].genders[0];
  });
  const selectedRow = $derived(split ? articleRows.find((a) => a.genders[0] === selected) ?? null : null);

  /** The header: the selected article of a split noun, else the word as looked up. */
  const head = $derived(display ? (split && selected ? { ...display, genders: [selected] } : display) : null);
  const forms = $derived(split ? '' : formsOf(display));
  const label = $derived(head ? displayTerm(head) : '');
  const formNote = $derived(
    lookup.form && display && lookup.form.toLowerCase() !== display.term.toLowerCase() ? `${lookup.form} → ${display.term}` : '',
  );
  const example = $derived((selectedRow ? selectedRow.examples : info?.examples ?? []).find((e) => e.de.trim()) ?? null);

  // Remember the word once it's found (the first resolved name only).
  let reported = false;
  $effect(() => {
    if (reported || lookingUp || !label) return;
    reported = true;
    onresolved?.(label);
  });

  // ---------- The user's cards ----------

  const lemma = $derived(display?.term ?? '');
  let owned = $state<OwnedCard[]>([]);
  $effect(() => {
    const t = lemma;
    if (!t) {
      owned = [];
      return;
    }
    const sub = liveQuery(() => ownedCards(t)).subscribe({ next: (v) => (owned = v), error: (e) => console.error(e) });
    return () => sub.unsubscribe();
  });
  /** A card with no article, or this one, counts as this article. */
  const hasArticle = (g: Gender) => owned.some((c) => !c.genders.length || c.genders.includes(g));
  /** Cards of the word shown: for a split noun only the selected article's. */
  const shownOwned = $derived(split && selected ? owned.filter((c) => !c.genders.length || c.genders.includes(selected)) : owned);
  const MAX_OWNED = 3;

  // ---------- Adding ----------

  function addSelected() {
    if (split && selectedRow && display) return addArticle(selectedRow);
    if (info) return onadd(info, label);
    // Not found: the word as typed; the details are filled in later (online).
    const p = parseGermanInput(word);
    const fields: WordFields = p.genders.length ? { term: p.term, pos: 'noun', genders: p.genders } : { term: p.term || word.trim() };
    onadd(fields, p.genders.length ? `${ARTICLE[p.genders[0]]} ${p.term}` : fields.term);
  }

  function addArticle(a: ArticleVariant) {
    if (!display) return;
    onadd(articleCardFields(display.term, a), `${ARTICLE[a.genders[0]]} ${display.term}`);
  }
</script>

<div class="card details" lang="de" in:fade={{ duration: dur(150) }}>
  <div class="head">
    <div class="lemma">
      {#if head}<Term card={head} />{:else}<span class:muted={lookingUp}>{word}</span>{/if}
    </div>
    {#if head || !lookingUp}
      <SpeakButton text={head ? speakableTerm(head) : word} size={26} />
    {/if}
  </div>
  {#if formNote}<div class="row"><span class="chip">{formNote}</span></div>{/if}

  {#if lookingUp && !info}
    <Skeleton lines={2} />
  {:else if !info}
    <div class="note small" lang="en">
      <Icon name={online.value ? 'search' : 'refresh'} size={20} />
      <div>
        {#if !online.value}
          <strong>Needs internet.</strong> “{word}” isn’t in the offline dictionary — connect to look it up.
        {:else if lookup.remoteState === 'failed'}
          The dictionary didn’t answer. Try again in a moment.
        {:else}
          Couldn’t find “{word}” in the dictionary.
        {/if}
      </div>
    </div>
  {:else if split && display}
    <div class="articles">
      <ArticleChoices
        term={display.term}
        articles={articleRows}
        {selected}
        trLang={lang}
        onpick={(a) => (picked = a.genders[0])}
        onadd={addArticle}
        isAdded={(a) => hasArticle(a.genders[0])}
        disabled={lookingUp}
      />
      <div class="small muted" lang="en">Each article has its own meaning — tap one to see it, + to add it.</div>
    </div>
  {:else}
    {#if forms}<div class="forms muted">{forms}</div>{/if}
    {#if translation}
      <div class="translation" lang={lang}><Meanings {translation} /></div>
    {:else if lookup.remoteState === 'loading'}
      <Skeleton lines={1} />
    {:else}
      <div class="small muted" lang="en">
        {#if !online.value}
          <strong>Needs internet</strong> for a translation of this word.
        {:else if lookup.remoteState === 'failed'}
          The dictionary is unavailable right now.
        {:else}
          No translation found.
        {/if}
      </div>
    {/if}
  {/if}

  {#if example}
    <div class="example">
      <div class="ex-text">
        <div>{example.de}</div>
        {#if example.tr}<div class="muted" lang={lang}>{example.tr}</div>{/if}
      </div>
      <SpeakButton text={example.de} />
    </div>
  {/if}

  {#if shownOwned.length}
    <div class="owned" lang="en">
      {#each shownOwned.slice(0, MAX_OWNED) as c (c.id)}
        <button type="button" class="owned-row" onclick={() => go(`/set/${c.setId}`)}>
          <span class="dot s-{c.status}"></span>
          <span class="owned-text"
            >In «<span lang="de">{c.setName}</span>»<span class="muted">{` · ${STATUS_LABELS[c.status]}`}</span></span
          >
          <Icon name="chevron" size={16} />
        </button>
      {/each}
      {#if shownOwned.length > MAX_OWNED}
        <div class="small muted more">and in {shownOwned.length - MAX_OWNED} more</div>
      {/if}
    </div>
  {/if}

  {#if !lookingUp || info}
    <button type="button" class="btn btn-block" class:btn-primary={!shownOwned.length} lang="en" onclick={addSelected} disabled={lookingUp}>
      <Icon name="plus" size={20} />
      <span class="ellipsis">
        {#if split && label}Add <span lang="de">{label}</span> to a set{:else if shownOwned.length}Add to another set{:else}Add to a set{/if}
      </span>
    </button>
  {/if}
</div>

<style>
  .details {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px 14px 16px 18px;
    border-radius: var(--radius-lg);
    background: var(--grad-feature);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
  }
  .lemma {
    flex: 1;
    min-width: 0;
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 800;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  .forms {
    font-size: 16px;
  }
  .translation {
    font-size: 19px;
    line-height: 1.4;
    color: var(--text-2);
    overflow-wrap: break-word;
  }
  .translation :global(.meanings) {
    gap: 4px;
  }
  .articles {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .note {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    line-height: 1.4;
  }
  .note > :global(svg) {
    color: var(--muted);
    flex-shrink: 0;
    margin-top: 1px;
  }
  .example {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    padding: 10px 4px 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--inset-bg);
    box-shadow: inset 0 0 0 1px var(--hairline);
    font-family: var(--font-read);
    font-style: italic;
    font-size: 16px;
  }
  .ex-text {
    flex: 1;
    min-width: 0;
    padding-top: 4px;
    overflow-wrap: break-word;
  }
  .owned {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .owned-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 4px 2px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 15px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }
  .owned-row > :global(svg) {
    color: var(--muted);
    flex-shrink: 0;
  }
  .owned-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .more {
    padding-left: 18px;
  }
  .dot {
    width: 8px;
    height: 8px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--muted);
  }
  .dot.s-learning {
    background: var(--accent-bar);
  }
  .dot.s-learned,
  .dot.s-known {
    background: var(--good);
  }
  .ellipsis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
</style>
