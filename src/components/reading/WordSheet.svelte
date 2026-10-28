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
  import { articleVariants, lookupLocal } from '../../lib/dict/local';
  import { saveCard } from '../../lib/db/repo';
  import type { LexEntry } from '../../lib/dict/types';
  import { lookupWord } from '../../lib/lookup/lookup';
  import { ARTICLE, displayPlural, displayVerbForms, speakableTerm } from '../../lib/german/articles';
  import { setKnown, STATUS_LABELS } from '../../lib/progress';
  import type { ArticleVariant, Card, Gender, LookupResult } from '../../lib/types';
  import type { Article } from '../../lib/reading/types';
  import type { CardRef } from '../../lib/reading/vocab';
  import {
    addWordToArticle,
    articleSetName,
    buildCard,
    ensureArticleSet,
    fieldsFromEntry,
    fieldsFromLookup,
  } from '../../lib/reading/store';
  import { showToast } from '../../lib/ui/dialogs.svelte';

  /**
   * Contents of the sheet that opens when a word in the reader is tapped: base form, article,
   * forms, translation, pronunciation, and add / known / not learned actions.
   */
  let {
    word,
    entry = null,
    context = '',
    article,
    setId = 0,
    cards = [],
    onclose,
  }: {
    /** The word as written in the text. */
    word: string;
    /** Lemma from the reader's precomputed map (may be null). */
    entry?: LexEntry | null;
    /** The sentence it appears in (stored as the card's example). */
    context?: string;
    article: Article;
    /** The article's word set (0 = not created yet). */
    setId?: number;
    /** The user's cards for this word's lemma (best status first). */
    cards?: CardRef[];
    onclose?: () => void;
  } = $props();

  let local = $state<LexEntry | null>(null);
  /** Every article of a noun whose articles differ in meaning (der See, die See); else [local]. */
  let localArticles = $state<LexEntry[]>([]);
  let localDone = $state(false);
  let remote = $state<LookupResult | null>(null);
  let remoteState = $state<'idle' | 'loading' | 'done' | 'failed'>('idle');
  let busy = $state(false);

  const lang = $derived(settings.lang);
  const setName = $derived(articleSetName(article.title));

  // Offline dictionary first; the online lookup only when it has nothing (or no translation).
  $effect(() => {
    const w = word;
    const ctrl = new AbortController();
    let cancelled = false;
    (async () => {
      let best: LexEntry | null = entry;
      let variants: LexEntry[] = [];
      try {
        const hits = await lookupLocal(w);
        best = hits[0]?.entry ?? entry;
        if (best) variants = await articleVariants(best);
      } catch {
        // keep the precomputed entry
      }
      if (cancelled) return;
      local = best;
      localArticles = variants;
      localDone = true;
      const untranslated = variants.length > 1 ? variants.some((v) => !v.tr[settings.lang]) : !best?.tr[settings.lang];
      if ((!best || untranslated) && online.value) {
        remoteState = 'loading';
        try {
          remote = await lookupWord(best?.term ?? w, settings.lang, ctrl.signal);
          if (!cancelled) remoteState = 'done';
        } catch {
          if (!cancelled) remoteState = 'failed';
        }
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  });

  /** Everything known about the word, local entry first, gaps filled from the online lookup. */
  const info = $derived.by((): (Partial<Card> & { term: string }) | null => {
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
  });

  const display = $derived(
    info
      ? {
          term: info.term,
          pos: info.pos ?? 'other',
          genders: info.genders ?? [],
          plural: info.plural ?? '',
          praeteritum: info.praeteritum ?? '',
          partizip2: info.partizip2 ?? '',
          auxiliary: info.auxiliary ?? '',
        }
      : null,
  );
  const forms = $derived(
    display ? (display.pos === 'noun' ? displayPlural(display) : display.pos === 'verb' ? displayVerbForms(display) : '') : '',
  );
  const translation = $derived(info?.translation?.trim() ?? '');
  const lookingUp = $derived(!localDone || remoteState === 'loading');
  const sameAsWord = $derived(!!display && display.term.toLowerCase() === word.toLowerCase());

  /**
   * A noun whose articles differ in meaning: one row per article ("der See — озеро",
   * "die See — море"), each added as its own card. Offline entries first, gaps from the lookup.
   */
  const articleRows = $derived.by((): ArticleVariant[] => {
    const online = remote?.term === local?.term || !local ? (remote?.articles ?? []) : [];
    if (localArticles.length > 1) {
      return localArticles.map((e) => {
        const r = online.find((a) => a.genders[0] === e.genders[0]);
        return { genders: [...e.genders], plural: e.plural || r?.plural || '', translation: e.tr[lang] || r?.translation || '', examples: r?.examples ?? [] };
      });
    }
    return online;
  });

  /** Genders of the user's cards for this lemma (to tell which article is in the set already). */
  let cardGenders = $state(new Map<number, Gender[]>());
  $effect(() => {
    const ids = cards.map((c) => c.id);
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
    cards.some((c) => (!inThisSet || c.setId === setId) && (cardGenders.get(c.id)?.length ? cardGenders.get(c.id)!.includes(g) : true));

  const inSet = $derived(!!setId && cards.some((c) => c.setId === setId));
  const status = $derived(cards[0]?.status);
  const isKnown = $derived(status === 'known' || status === 'learned');

  let otherSet = $state('');
  $effect(() => {
    const ref = cards.find((c) => c.setId !== setId) ?? null;
    otherSet = '';
    if (!ref) return;
    void db.sets.get(ref.setId).then((s) => (otherSet = s ? s.topic || s.name : ''));
  });

  /** Card fields for adding: what we know, or just the word (filled in later). */
  function fields(): Partial<Card> & { term: string } {
    return info ?? { term: word };
  }

  async function add(): Promise<number | null> {
    if (busy) return null;
    busy = true;
    try {
      const r = await addWordToArticle(article, fields(), context);
      showToast(r.created ? `Added to «${setName}»` : `Already in «${setName}»`, {
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
      const term = display.term.trim().toLowerCase();
      const existing = (await db.cards.where('setId').equals(setId).toArray()).find(
        (c) => c.term.toLowerCase() === term && (!c.genders.length || c.genders.includes(g)),
      );
      const fields: Partial<Card> = {
        term: display.term,
        pos: 'noun',
        genders: [g],
        plural: a.plural,
        translation: a.translation,
        examples: a.examples.map((e) => ({ ...e })),
      };
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
    let ids = cards.map((c) => c.id);
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
    const ids = cards.map((c) => c.id);
    if (!ids.length) return;
    await setKnown(ids, false);
    showToast(`“${display?.term ?? word}” is back to learning`);
  }
</script>

<div class="word-sheet" lang="de">
  <div class="head">
    <div class="titles">
      {#if !sameAsWord || !display}<div class="as-written muted">{word}</div>{/if}
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
      <button class="btn btn-primary btn-block add" onclick={add} disabled={busy || lookingUp}>
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
