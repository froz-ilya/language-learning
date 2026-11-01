<script lang="ts">
  import Icon from '../Icon.svelte';
  import Term from '../Term.svelte';
  import Meanings from '../Meanings.svelte';
  import SpeakButton from '../SpeakButton.svelte';
  import Skeleton from '../Skeleton.svelte';
  import ArticleChoices from '../ArticleChoices.svelte';
  import ReadingSwitch from '../ReadingSwitch.svelte';
  import { go } from '../../lib/router.svelte';
  import { online } from '../../lib/online.svelte';
  import { settings } from '../../lib/settings.svelte';
  import { i18n, systemName, t } from '../../lib/i18n.svelte';
  import { db } from '../../lib/db/schema';
  import { saveCard } from '../../lib/db/repo';
  import type { LexEntry } from '../../lib/dict/types';
  import { ARTICLE, displayTerm, speakableTerm } from '../../lib/german/articles';
  import { setKnown, STATUS_LABELS } from '../../lib/progress';
  import type { ArticleVariant, Card, Gender, LookupResult } from '../../lib/types';
  import type { Article } from '../../lib/reading/types';
  import type { CardRef } from '../../lib/reading/vocab';
  import { addWordToArticle, articleSetName, articleTitle, buildCard, ensureArticleSet } from '../../lib/reading/store';
  import {
    articleCardFields,
    articleRowsOf,
    cardIsReading,
    displayOf,
    formsOf,
    hasHomographs,
    initialWordLookup,
    loadWordInfo,
    mergeInfo,
    openingReadingId,
    prepsText,
    wordReadings,
    type WordFields,
    type WordReading,
  } from '../../lib/search/wordInfo';
  import { findDuplicate } from '../../lib/search/addToSet';
  import { showToast } from '../../lib/ui/dialogs.svelte';

  /**
   * Contents of the sheet that opens when a word in the reader is tapped: base form, article,
   * forms, translation, pronunciation, and add / known / not learned actions. A word with several
   * readings (sein, treffen / sich treffen) gets a switcher; everything follows the reading shown.
   */
  let {
    word,
    written,
    entry = null,
    readings,
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
    /**
     * Every dictionary word the tapped text can be, best first (sein: the verb, the possessive,
     * das Sein). With 2+ the sheet opens on the first and offers the others in its switcher,
     * and `entry` isn't used; absent or one item: just `word`.
     */
    readings?: LexEntry[];
    /** The sentence it appears in (stored as the card's example). */
    context?: string;
    article: Article;
    /** The article's word set (0 = not created yet). */
    setId?: number;
    /** The user's cards for this word's lemma (best status first). */
    cards?: CardRef[];
    /** The user's cards for any term (for the word's other readings). */
    cardsOfTerm?: (term: string) => CardRef[];
    onclose?: () => void;
  } = $props();

  /** The caller's readings, when there is anything to choose from. */
  const given = $derived(readings && readings.length > 1 ? readings : null);
  /** Reading picked in the switcher; null = the word as it opened. */
  let chosen = $state.raw<WordReading | null>(null);
  const current = $derived(chosen?.term ?? given?.[0].term ?? word);

  /** Offline entry, its articles, and the online lookup when needed (see lib/search/wordInfo). */
  let lookup = $state(initialWordLookup());
  /** The word as it opened: its readings stay on offer while another one is shown. */
  let opening = $state.raw(initialWordLookup());
  /** Lookups answered so far: a verb's "sich …" reading may be known only from one. */
  let remotes = $state.raw<LookupResult[]>([]);
  let busy = $state(false);

  const lang = $derived(settings.lang);
  const setName = $derived(articleSetName(articleTitle(article)));

  // Offline dictionary first; the online lookup only when it has nothing (or no translation).
  // Switching away aborts the reading's lookup; a finished one comes from the lookup's cache.
  $effect(() => {
    const pick = chosen;
    const first = given?.[0];
    const ctrl = new AbortController();
    void loadWordInfo(current, {
      entry: pick ? pick.entry : (first ?? entry),
      fixed: pick ? !!pick.entry : !!first,
      lang: settings.lang,
      isOnline: () => online.value,
      signal: ctrl.signal,
      onchange: (s) => {
        lookup = s;
        if (!pick) opening = s;
        if (s.remote) remotes = [...remotes, s.remote];
      },
    });
    return () => ctrl.abort();
  });

  /** Without `readings` only the word's own: its "sich …" reading (or plain verb). */
  const options = $derived(wordReadings(given ?? opening.readings.slice(0, 1), settings.lang, remotes));
  const openingId = $derived(openingReadingId(opening));

  function pickReading(id: string) {
    chosen = id === openingId ? null : (options.find((o) => o.id === id) ?? null);
  }

  const remoteState = $derived(lookup.remoteState);
  /** Everything known about the word, local entry first, gaps filled from the online lookup. */
  const info = $derived(mergeInfo(lookup.local, lookup.remote, lang));
  const display = $derived(displayOf(info));
  const forms = $derived(formsOf(display));
  const preps = $derived(prepsText(info?.preps));
  const translation = $derived(info?.translation?.trim() ?? '');
  const lookingUp = $derived(!lookup.localDone || remoteState === 'loading');
  const shown = $derived(written ?? word);
  const sameAsWord = $derived(!!display && display.term.toLowerCase() === shown.toLowerCase());

  /**
   * A noun whose articles differ in meaning: one row per article ("der See — озеро",
   * "die See — море"), each added as its own card. Offline entries first, gaps from the lookup.
   */
  const articleRows = $derived(articleRowsOf(lookup.local, lookup.localArticles, lookup.remote, lang));

  /** The user's cards spelled like the reading shown (the opening one's are the caller's `cards`). */
  const termCards = $derived(chosen || given ? (cardsOfTerm?.(current) ?? (chosen ? [] : cards)) : cards);
  /** Those cards' details (which article is in the set already, which reading they are). */
  let cardRows = $state(new Map<number, Pick<Card, 'genders' | 'pos'>>());
  $effect(() => {
    const ids = termCards.map((c) => c.id);
    if (!ids.length) {
      cardRows = new Map();
      return;
    }
    void db.cards.bulkGet(ids).then((rows) => {
      cardRows = new Map(rows.filter((c) => !!c).map((c) => [c!.id!, c!]));
    });
  });
  /** The cards of the word shown: a card "sein" isn't "das Sein". */
  const shownCards = $derived(
    display && hasHomographs(options, display.term) ? termCards.filter((c) => cardIsReading(cardRows.get(c.id)?.pos, display!.pos)) : termCards,
  );
  /** A card in this set with no article, or this article, counts as this article. */
  const hasArticle = (g: Gender, inThisSet: boolean) =>
    shownCards.some((c) => (!inThisSet || c.setId === setId) && (cardRows.get(c.id)?.genders.length ? cardRows.get(c.id)!.genders.includes(g) : true));

  const inSet = $derived(!!setId && shownCards.some((c) => c.setId === setId));
  const status = $derived(shownCards[0]?.status);
  const isKnown = $derived(status === 'known' || status === 'learned');

  let otherSet = $state('');
  $effect(() => {
    const ref = shownCards.find((c) => c.setId !== setId) ?? null;
    otherSet = '';
    if (!ref) return;
    void db.sets.get(ref.setId).then((s) => (otherSet = s ? systemName(s.topic || s.name) : ''));
  });

  /** Card fields for adding: what we know, or just the word (filled in later). */
  function fields(): WordFields {
    return info ?? { term: current };
  }

  /** Add the word shown (named in the toast when it's one of several readings). */
  async function add(): Promise<number | null> {
    if (busy) return null;
    busy = true;
    try {
      const f = fields();
      const r = await addWordToArticle(article, f, context);
      const term = options.length > 1 ? (display ? displayTerm(display) : f.term) : '';
      const message = term
        ? t(r.created ? 'reading.word.addedTerm' : 'reading.word.alreadyTerm', { term, set: setName })
        : t(r.created ? 'reading.word.added' : 'reading.word.already', { set: setName });
      showToast(message, {
        actionLabel: t('reading.openSet'),
        onAction: () => go(`/set/${r.setId}`),
      });
      return r.cardId;
    } catch (e) {
      showToast(t('reading.word.addFailed', { error: (e as Error).message }));
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
      showToast(t(existing ? 'reading.word.articleAlready' : 'reading.word.articleAdded', { label, set: setName }), {
        actionLabel: t('reading.openSet'),
        onAction: () => go(`/set/${setId}`),
      });
      return cardId;
    } catch (e) {
      showToast(t('reading.word.addFailed', { error: (e as Error).message }));
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
    showToast(t('reading.word.markedKnown', { term: display?.term ?? word }));
    onclose?.();
  }

  async function notLearned() {
    const ids = shownCards.map((c) => c.id);
    if (!ids.length) return;
    await setKnown(ids, false);
    showToast(t('reading.word.backToLearning', { term: display?.term ?? word }));
  }
</script>

<div class="word-sheet" lang="de">
  <div class="head">
    <div class="titles">
      {#if !sameAsWord || !display}<div class="as-written muted">{shown}</div>{/if}
      {#if display}
        <div class="lemma"><Term card={articleRows.length > 1 ? { ...display, genders: [] } : display} /></div>
      {:else if !lookingUp}
        <div class="lemma">{current}</div>
      {/if}
    </div>
    {#if display || !lookingUp}
      <SpeakButton text={display ? speakableTerm(display) : current} size={26} />
    {/if}
  </div>

  {#if options.length > 1}
    <ReadingSwitch {options} selected={chosen?.id ?? openingId} onpick={pickReading} />
  {/if}

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
      <div class="small muted" lang={i18n.lang}>{t('reading.word.articlesHint')}</div>
    </div>
  {:else}
    {#if forms}<div class="forms muted">{forms}</div>{/if}
    {#if preps}<div class="preps muted small">{preps}</div>{/if}
    {#if translation}
      <div class="translation" lang={lang}><Meanings {translation} /></div>
    {:else if remoteState === 'loading'}
      <Skeleton lines={1} />
    {:else}
      <div class="missing muted small" lang={i18n.lang}>
        {#if !online.value}
          {t('reading.word.noOffline')}
        {:else if remoteState === 'failed'}
          {t('reading.word.dictDown')}
        {:else}
          {t('reading.word.notFound')}
        {/if}
      </div>
    {/if}
  {/if}

  {#if status}
    <div class="status small" lang={i18n.lang}>
      <span class="dot s-{status}"></span>{STATUS_LABELS[status]}{#if otherSet}<span class="muted"> · {t('reading.word.inNamed', { set: otherSet })}</span>{/if}
    </div>
  {/if}

  <div class="actions" lang={i18n.lang}>
    {#if articleRows.length > 1}
      {#if inSet}
        <button class="btn btn-ghost btn-block" onclick={() => go(`/set/${setId}`)}>{t('reading.openNamed', { set: setName })}</button>
      {/if}
    {:else if inSet}
      <div class="row">
        <span class="in-set"><Icon name="check" size={18} /> {t('reading.word.inSet')}</span>
        <button class="btn btn-ghost" onclick={() => go(`/set/${setId}`)}>{t('reading.openSet')}</button>
      </div>
    {:else}
      <button class="btn btn-primary btn-block add" onclick={() => add()} disabled={busy || lookingUp}>
        <Icon name="plus" size={18} /><span class="ellipsis">{t('reading.word.addTo', { set: setName })}</span>
      </button>
    {/if}
    <div class="row two">
      {#if isKnown}
        <button class="btn" onclick={notLearned}>{t('reading.word.notLearned')}</button>
      {:else}
        <button class="btn" onclick={markKnown} disabled={busy || lookingUp}><Icon name="check" size={18} /> {t('reading.word.markKnown')}</button>
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
