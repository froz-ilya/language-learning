<script lang="ts">
  import Icon from '../Icon.svelte';
  import Term from '../Term.svelte';
  import Meanings from '../Meanings.svelte';
  import SpeakButton from '../SpeakButton.svelte';
  import Skeleton from '../Skeleton.svelte';
  import ArticleChoices from '../ArticleChoices.svelte';
  import { go } from '../../lib/router.svelte';
  import { online } from '../../lib/online.svelte';
  import { settings } from '../../lib/settings.svelte';
  import { db } from '../../lib/db/schema';
  import { saveCard } from '../../lib/db/repo';
  import type { LexEntry } from '../../lib/dict/types';
  import { asReflexive } from '../../lib/german/reflexive';
  import { ARTICLE, speakableTerm } from '../../lib/german/articles';
  import { setKnown, STATUS_LABELS } from '../../lib/progress';
  import type { ArticleVariant, Gender } from '../../lib/types';
  import type { Article } from '../../lib/reading/types';
  import type { CardRef } from '../../lib/reading/vocab';
  import { addWordToArticle, articleSetName, buildCard, ensureArticleSet } from '../../lib/reading/store';
  import {
    articleCardFields,
    articleRowsOf,
    displayOf,
    formsOf,
    initialWordLookup,
    loadWordInfo,
    mergeInfo,
    prepsText,
    reflexiveReadingOf,
    type WordFields,
  } from '../../lib/search/wordInfo';
  import { findDuplicate } from '../../lib/search/addToSet';
  import { showToast } from '../../lib/ui/dialogs.svelte';

  /**
   * Contents of the sheet that opens when a word in the reader is tapped: base form, article,
   * forms, translation, pronunciation, and add / known / not learned actions.
   */
  let {
    word,
    written,
    entry = null,
    context = '',
    article,
    setId = 0,
    cards = [],
    cardsOfTerm,
    onclose,
  }: {
    /** The word to look up: as written in the text, or the joined verb of a split or reflexive verb (anrufen, sich treffen). */
    word: string;
    /** The text as it appears in the article when it isn't `word` ("rufe … an"). */
    written?: string;
    /** Lemma from the reader's precomputed map (may be null). */
    entry?: LexEntry | null;
    /** The sentence it appears in (stored as the card's example). */
    context?: string;
    article: Article;
    /** The article's word set (0 = not created yet). */
    setId?: number;
    /** The user's cards for this word's lemma (best status first). */
    cards?: CardRef[];
    /** The user's cards for any term (for the verb's "sich …" reading). */
    cardsOfTerm?: (term: string) => CardRef[];
    onclose?: () => void;
  } = $props();

  /**
   * Switched to the verb's reflexive reading from its row ("sich treffen"): what is looked up
   * instead, and the plain reading to switch back to.
   */
  let switched = $state<{ term: string; entry: LexEntry | null; back: { term: string; translation: string } } | null>(null);
  const current = $derived(switched?.term ?? word);
  /** The cards of the word shown. */
  const shownCards = $derived(switched ? (cardsOfTerm?.(switched.term) ?? []) : cards);

  /** Offline entry, its articles, and the online lookup when needed (see lib/search/wordInfo). */
  let lookup = $state(initialWordLookup());
  let busy = $state(false);

  const lang = $derived(settings.lang);
  const setName = $derived(articleSetName(article.title));

  // Offline dictionary first; the online lookup only when it has nothing (or no translation).
  $effect(() => {
    const ctrl = new AbortController();
    void loadWordInfo(current, {
      entry: switched ? switched.entry : entry,
      lang: settings.lang,
      isOnline: () => online.value,
      signal: ctrl.signal,
      onchange: (s) => (lookup = s),
    });
    return () => ctrl.abort();
  });

  const remoteState = $derived(lookup.remoteState);
  /** Everything known about the word, local entry first, gaps filled from the online lookup. */
  const info = $derived(mergeInfo(lookup.local, lookup.remote, lang));
  const display = $derived(displayOf(info));
  const forms = $derived(formsOf(display));
  const preps = $derived(prepsText(info?.preps));
  const translation = $derived(info?.translation?.trim() ?? '');

  /** A plain verb's reflexive reading ("sich treffen — встречаться"): a row to switch to or add. */
  const reflexive = $derived(switched ? null : reflexiveReadingOf(lookup.local, lookup.remote, lang));
  /** Its translation, unless it's just the plain verb's again. */
  const reflexiveTr = $derived(reflexive?.translation && reflexive.translation !== translation ? reflexive.translation : '');
  const reflexiveInSet = $derived(!!reflexive && !!setId && (cardsOfTerm?.(reflexive.term) ?? []).some((c) => c.setId === setId));

  function switchToReflexive() {
    if (!reflexive) return;
    const local = lookup.local;
    switched = {
      term: reflexive.term,
      entry: local ? asReflexive(local) : null,
      back: { term: display?.term ?? word, translation },
    };
  }
  const lookingUp = $derived(!lookup.localDone || remoteState === 'loading');
  const shown = $derived(written ?? word);
  const sameAsWord = $derived(!!display && display.term.toLowerCase() === shown.toLowerCase());

  /**
   * A noun whose articles differ in meaning: one row per article ("der See — озеро",
   * "die See — море"), each added as its own card. Offline entries first, gaps from the lookup.
   */
  const articleRows = $derived(articleRowsOf(lookup.local, lookup.localArticles, lookup.remote, lang));

  /** Genders of the user's cards for this lemma (to tell which article is in the set already). */
  let cardGenders = $state(new Map<number, Gender[]>());
  $effect(() => {
    const ids = shownCards.map((c) => c.id);
    if (!ids.length) {
      cardGenders = new Map();
      return;
    }
    void db.cards.bulkGet(ids).then((rows) => {
      cardGenders = new Map(rows.filter((c) => !!c).map((c) => [c!.id!, c!.genders]));
    });
  });
  /** A card in this set with no article, or this article, counts as this article. */
  const hasArticle = (g: Gender, inThisSet: boolean) =>
    shownCards.some((c) => (!inThisSet || c.setId === setId) && (cardGenders.get(c.id)?.length ? cardGenders.get(c.id)!.includes(g) : true));

  const inSet = $derived(!!setId && shownCards.some((c) => c.setId === setId));
  const status = $derived(shownCards[0]?.status);
  const isKnown = $derived(status === 'known' || status === 'learned');

  let otherSet = $state('');
  $effect(() => {
    const ref = shownCards.find((c) => c.setId !== setId) ?? null;
    otherSet = '';
    if (!ref) return;
    void db.sets.get(ref.setId).then((s) => (otherSet = s ? s.topic || s.name : ''));
  });

  /** Card fields for adding: what we know, or just the word (filled in later). */
  function fields(): WordFields {
    return info ?? { term: current };
  }

  /** Add the word shown, or `f` (the reflexive reading, named in the toast). */
  async function add(f?: WordFields): Promise<number | null> {
    if (busy) return null;
    busy = true;
    try {
      const r = await addWordToArticle(article, f ?? fields(), context);
      const name = f ? `“${f.term}” ` : '';
      showToast(r.created ? `Added ${name}to «${setName}»` : `${name ? `${name}is already` : 'Already'} in «${setName}»`, {
        actionLabel: 'Open set',
        onAction: () => go(`/set/${r.setId}`),
      });
      return r.cardId;
    } catch (e) {
      showToast(`Couldn’t add the word: ${(e as Error).message}`);
      return null;
    } finally {
      busy = false;
    }
  }

  /** Add one article ("die See") as its own card; a card of that article in the set is kept. */
  async function addArticleCard(a: ArticleVariant): Promise<number | null> {
    if (busy || !display) return null;
    busy = true;
    const g = a.genders[0];
    const label = `${ARTICLE[g]} ${display.term}`;
    try {
      const setId = await ensureArticleSet(article);
      const fields = articleCardFields(display.term, a);
      const existing = findDuplicate(await db.cards.where('setId').equals(setId).toArray(), fields);
      const cardId = existing?.id ?? (await saveCard(buildCard(setId, fields, context)));
      showToast(existing ? `${label} is already in «${setName}»` : `Added ${label} to «${setName}»`, {
        actionLabel: 'Open set',
        onAction: () => go(`/set/${setId}`),
      });
      return cardId;
    } catch (e) {
      showToast(`Couldn’t add the word: ${(e as Error).message}`);
      return null;
    } finally {
      busy = false;
    }
  }

  async function markKnown() {
    let ids = shownCards.map((c) => c.id);
    if (!ids.length) {
      const id = articleRows.length > 1 ? await addArticleCard(articleRows[0]) : await add();
      if (id === null) return;
      ids = [id];
    }
    await setKnown(ids, true);
    showToast(`“${display?.term ?? word}” marked as known`);
    onclose?.();
  }

  async function notLearned() {
    const ids = shownCards.map((c) => c.id);
    if (!ids.length) return;
    await setKnown(ids, false);
    showToast(`“${display?.term ?? word}” is back to learning`);
  }
</script>

<div class="word-sheet" lang="de">
  <div class="head">
    <div class="titles">
      {#if !sameAsWord || !display}<div class="as-written muted">{shown}</div>{/if}
      {#if display}
        <div class="lemma"><Term card={articleRows.length > 1 ? { ...display, genders: [] } : display} /></div>
      {:else if !lookingUp}
        <div class="lemma">{word}</div>
      {/if}
    </div>
    {#if display || !lookingUp}
      <SpeakButton text={display ? speakableTerm(display) : word} size={26} />
    {/if}
  </div>

  {#if lookingUp && !info}
    <Skeleton lines={2} />
  {:else if articleRows.length > 1 && display}
    <div class="articles">
      <ArticleChoices
        term={display.term}
        articles={articleRows}
        trLang={lang}
        onadd={(a) => void addArticleCard(a)}
        isAdded={(a) => hasArticle(a.genders[0], true) && !!setId}
        disabled={busy || lookingUp}
      />
      <div class="small muted" lang="en">Each article has its own meaning — add the one you need.</div>
    </div>
  {:else}
    {#if forms}<div class="forms muted">{forms}</div>{/if}
    {#if preps}<div class="preps muted small">{preps}</div>{/if}
    {#if translation}
      <div class="translation" lang={lang}><Meanings {translation} /></div>
    {:else if remoteState === 'loading'}
      <Skeleton lines={1} />
    {:else}
      <div class="missing muted small" lang="en">
        {#if !online.value}
          No offline translation. It will be filled in when you’re online.
        {:else if remoteState === 'failed'}
          The dictionary is unavailable right now. You can still add the word and fill it in later.
        {:else}
          No translation found.
        {/if}
      </div>
    {/if}
  {/if}

  {#if reflexive}
    <div class="alt">
      <button type="button" class="alt-main" onclick={switchToReflexive}>
        <span class="alt-term">{reflexive.term}</span>{#if reflexiveTr}<span class="alt-tr" lang={lang}>— {reflexiveTr}</span>{/if}
      </button>
      {#if reflexiveInSet}
        <span class="alt-done" aria-label="{reflexive.term} is in the set"><Icon name="check" size={18} /></span>
      {:else}
        <button type="button" class="alt-add" aria-label="Add {reflexive.term}" disabled={busy || lookingUp} onclick={() => reflexive && void add(reflexive)}
          ><Icon name="plus" size={18} /></button
        >
      {/if}
    </div>
  {:else if switched}
    <button type="button" class="alt alt-main back" onclick={() => (switched = null)}>
      <span class="alt-term">{switched.back.term}</span>{#if switched.back.translation}<span class="alt-tr" lang={lang}>— {switched.back.translation}</span>{/if}
    </button>
  {/if}

  {#if status}
    <div class="status small" lang="en">
      <span class="dot s-{status}"></span>{STATUS_LABELS[status]}{#if otherSet}<span class="muted"> · in «{otherSet}»</span>{/if}
    </div>
  {/if}

  <div class="actions" lang="en">
    {#if articleRows.length > 1}
      {#if inSet}
        <button class="btn btn-ghost btn-block" onclick={() => go(`/set/${setId}`)}>Open «{setName}»</button>
      {/if}
    {:else if inSet}
      <div class="row">
        <span class="in-set"><Icon name="check" size={18} /> In set</span>
        <button class="btn btn-ghost" onclick={() => go(`/set/${setId}`)}>Open set</button>
      </div>
    {:else}
      <button class="btn btn-primary btn-block add" onclick={() => add()} disabled={busy || lookingUp}>
        <Icon name="plus" size={18} /><span class="ellipsis">Add to «{setName}»</span>
      </button>
    {/if}
    <div class="row two">
      {#if isKnown}
        <button class="btn" onclick={notLearned}>Not learned</button>
      {:else}
        <button class="btn" onclick={markKnown} disabled={busy || lookingUp}><Icon name="check" size={18} /> Mark known</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .word-sheet {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 4px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  .as-written {
    font-size: 15px;
  }
  .lemma {
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 800;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  .forms {
    font-size: 16px;
  }
  .preps {
    margin-top: -6px;
  }
  .alt {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 40px;
    border-radius: var(--radius-sm);
    background: var(--inset-bg);
    box-shadow: inset 0 0 0 1px var(--hairline);
  }
  .alt-main {
    flex: 1;
    min-width: 0;
    padding: 8px 12px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 15px;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .alt.back {
    display: block;
    width: 100%;
  }
  .alt-term {
    font-family: var(--font-display);
    font-weight: 800;
  }
  .alt-tr {
    margin-left: 0.3em;
    color: var(--text-2);
  }
  .alt-add,
  .alt-done {
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    width: 36px;
    height: 36px;
    margin-right: 2px;
    border-radius: 50%;
    color: var(--accent);
  }
  .alt-add {
    border: 0;
    background: color-mix(in srgb, currentColor 12%, var(--surface));
    cursor: pointer;
  }
  .alt-add:disabled {
    opacity: 0.5;
  }
  .alt-done {
    color: var(--good);
  }
  .translation {
    font-size: 19px;
    line-height: 1.4;
    overflow-wrap: break-word;
  }
  .translation :global(.meanings) {
    gap: 4px;
  }
  .missing {
    line-height: 1.4;
  }
  .articles {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
  }
  .dot {
    width: 8px;
    height: 8px;
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
  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row.two > :global(*) {
    flex: 1;
  }
  .in-set {
    flex: 1;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--good);
    font-family: var(--font-display);
    font-weight: 800;
    padding-left: 4px;
  }
  .add {
    min-width: 0;
  }
  .ellipsis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
</style>
