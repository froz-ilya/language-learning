<script lang="ts">
  import { tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Sheet from '../components/Sheet.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import EmptyState from '../components/library/EmptyState.svelte';
  import WordSheet from '../components/reading/WordSheet.svelte';
  import { back, go, route } from '../lib/router.svelte';
  import { live } from '../lib/live.svelte';
  import { dur } from '../lib/motion';
  import { online } from '../lib/online.svelte';
  import { settings } from '../lib/settings.svelte';
  import { db } from '../lib/db/schema';
  import { addCards } from '../lib/db/repo';
  import { speak, stopSpeaking } from '../lib/speech/tts';
  import type { LexEntry } from '../lib/dict/types';
  import { getArticle, knownLevel, LICENSE_URLS, sourceInfo } from '../lib/reading/sources';
  import { nextPart } from '../lib/reading/sources/gutenberg';
  import { isRemovedError } from '../lib/reading/sources/klexikon';
  import { headingText, isHeading, sentenceAt, tokenize, countWords, type Token } from '../lib/reading/text';
  import { comfortRank, estimateLevel, isFunctionWord, knownShare } from '../lib/reading/level';
  import { rankLookup } from '../lib/reading/rate';
  import { splitVerbs, type SplitVerb } from '../lib/reading/separable';
  import { groupText, reflexiveVerbs, verbGroups, type ReflexiveVerb, type VerbGroup } from '../lib/reading/reflexive';
  import { cardsFor, cardsOfTerm, lemmaMap, loadVocab, type CardRef } from '../lib/reading/vocab';
  import { asReflexive } from '../lib/german/reflexive';
  import { entryFields } from '../lib/search/wordInfo';
  import {
    articleIdFromParts,
    articlePath,
    articleSetName,
    buildCard,
    deleteArticle,
    ensureArticleSet,
    markRead,
    removeFromSaved,
    saveForOffline,
    setLevel,
    setProgress,
    stopReading,
    trackOpen,
  } from '../lib/reading/store';
  import type { Article } from '../lib/reading/types';
  import type { LevelCode } from '../lib/levels/types';
  import type { Card } from '../lib/types';
  import { confirmAction, showToast } from '../lib/ui/dialogs.svelte';

  const id = articleIdFromParts(route.parts);
  const WORDS_PER_MINUTE = 120;

  let article = $state<Article | null>(null);
  let error = $state('');
  /** The article no longer exists on its site (deleted): no point in "Try again". */
  let removed = $state(false);
  let attempt = $state(0);

  const row = live(() => db.articles.get(id));
  const vocab = live(loadVocab);

  // ---------- Load ----------

  $effect(() => {
    void attempt;
    const ctrl = new AbortController();
    error = '';
    removed = false;
    getArticle(id, ctrl.signal)
      .then(async (a) => {
        if (ctrl.signal.aborted) return;
        if (!a.paragraphs.length) throw new Error('This article has no text we can show.');
        article = a;
        try {
          const r = await trackOpen(a);
          await restorePosition(r.progress, r.readAt);
        } catch {
          // Tracking is best-effort (private mode).
        }
      })
      .catch((e: Error) => {
        if (ctrl.signal.aborted || e.name === 'AbortError') return;
        removed = isRemovedError(e);
        error = online.value ? e.message || 'Couldn’t load the article.' : 'You’re offline and this article isn’t saved.';
      });
    return () => ctrl.abort();
  });

  const paragraphs = $derived(article?.paragraphs ?? []);
  const tokens = $derived(paragraphs.map((p) => tokenize(headingText(p))));
  const allTokens = $derived(tokens.flat());
  const wordCount = $derived(paragraphs.filter((p) => !isHeading(p)).reduce((n, p) => n + countWords(p), 0));
  const minutes = $derived(Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE)));

  // ---------- Words: lemmas (once per article) and the user's cards (live) ----------

  let lemmas = $state<Map<string, LexEntry | null> | null>(null);

  $effect(() => {
    const t = tokens;
    if (!t.length) return;
    let cancelled = false;
    void lemmaMap(t)
      .then((m) => !cancelled && (lemmas = m))
      .catch(() => !cancelled && (lemmas = new Map()));
    return () => {
      cancelled = true;
    };
  });

  /** Separable verbs split across a clause ("rufe … an" → anrufen), one map per paragraph; null until found. */
  let splits = $state.raw<Map<number, SplitVerb>[] | null>(null);
  /** Reflexive verbs ("treffen … uns" → sich treffen, "ziehe mich … an"), found after the split verbs. */
  let reflexives = $state.raw<Map<number, ReflexiveVerb>[] | null>(null);

  $effect(() => {
    const t = tokens;
    splits = null;
    reflexives = null;
    if (!t.length) return;
    let cancelled = false;
    void splitVerbs(t)
      .then(async (m) => {
        if (cancelled) return;
        splits = m;
        const r = await reflexiveVerbs(t, m);
        if (!cancelled) reflexives = r;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });

  /** Verbs written as several tokens, per paragraph: a reflexive verb wins over a split one sharing a token. */
  const groups = $derived(splits ? splits.map((m, p) => verbGroups(m, reflexives?.[p])) : null);

  /** The split or reflexive verb a token belongs to (as the verb, the particle or the pronoun). */
  const groupAt = (p: number, t: number): VerbGroup | undefined => groups?.[p]?.get(t);

  const NO_LEMMAS = new Map<string, LexEntry | null>();
  const cardsOf = (w: string): CardRef[] => (vocab.value ? cardsFor(w, lemmas ?? NO_LEMMAS, vocab.value) : []);
  /** Cards for a term itself (a split verb's anrufen, "sich treffen"), not via the text's lemmas. */
  const cardsOfWord = (term: string): CardRef[] => cardsOfTerm(term, vocab.value);
  const cardsOfEntry = (e: LexEntry): CardRef[] => cardsOfWord(e.term);

  /** Words up to this rank count as familiar (the user's level); rarer ones are highlighted as new. */
  const comfort = $derived(comfortRank(settings.focus));
  const isNewWord = (e: LexEntry | null | undefined, word: string) =>
    e ? !isFunctionWord(e) && e.rank > comfort : /^\p{Ll}/u.test(word) && word.length > 2;

  /** CSS class per distinct word: 'u' new (dotted), 'l' learning (tinted), '' familiar/known/function word. */
  const classes = $derived.by(() => {
    const map = new Map<string, string>();
    if (!vocab.value) return map;
    for (const t of allTokens) {
      if (!t.word || map.has(t.text)) continue;
      const refs = cardsOf(t.text);
      let cls = '';
      // Tint only words being studied; a card that's in a set but never studied (e.g. a whole
      // installed level) shouldn't light up every common word.
      if (refs.length) cls = refs[0].status === 'learning' ? 'l' : '';
      else if (lemmas && isNewWord(lemmas.get(t.text), t.text)) cls = 'u';
      map.set(t.text, cls);
    }
    return map;
  });

  /** Classes for the tokens of split and reflexive verbs, by paragraph and token index: coloured as the joined verb. */
  const groupClasses = $derived.by(() => {
    if (!groups || !vocab.value) return null;
    return groups.map((m) => {
      const out = new Map<number, string>();
      for (const g of new Set(m.values())) {
        const refs = cardsOfEntry(g.entry);
        const cls = refs.length ? (refs[0].status === 'learning' ? 'l' : '') : isNewWord(g.entry, g.entry.term) ? 'u' : '';
        for (const t of g.tokens) out.set(t, cls);
      }
      return out;
    });
  });

  const classOf = (p: number, t: number, text: string) => groupClasses?.[p]?.get(t) ?? classes.get(text) ?? '';

  const share = $derived(vocab.value ? knownShare(allTokens, (w) => cardsOf(w)[0]?.status) : null);

  /**
   * The level the article's list shows (catalog / bundled / rated intro), so list and reader
   * agree. undefined while looking it up; null when unknown (the text is estimated instead).
   */
  let listedLevel = $state<LevelCode | null | undefined>(undefined);
  $effect(() => {
    const a = article;
    if (!a) return;
    let cancelled = false;
    listedLevel = undefined;
    knownLevel(a.id, a.title)
      .then((l) => !cancelled && (listedLevel = l))
      .catch(() => !cancelled && (listedLevel = null));
    return () => {
      cancelled = true;
    };
  });

  const estimated = $derived.by(() => {
    if (listedLevel) return listedLevel;
    if (listedLevel === undefined || !lemmas || !allTokens.length) return null;
    return estimateLevel(allTokens, rankLookup(lemmas), { title: article?.title });
  });
  const level = $derived(row.value?.level || estimated || '');

  $effect(() => {
    if (estimated && row.value && row.value.level !== estimated) void setLevel(id, estimated);
  });

  /** Lemmas worth adding: in the dictionary, above the user's level, not in any set yet. */
  const unknown = $derived.by(() => {
    const out = new Map<string, { entry: LexEntry; context: string }>();
    if (!lemmas || !vocab.value) return out;
    tokens.forEach((list, pi) => {
      let offset = 0;
      list.forEach((t, ti) => {
        // A split or reflexive verb counts once, as the joined verb at its verb token; its particle
        // and pronoun not at all. A verb used only with "sich" counts as "sich beeilen".
        const group = groupAt(pi, ti);
        const lemma = t.word ? lemmas!.get(t.text) : null;
        const e = group ? (group.verb === ti ? group.entry : null) : lemma?.reflexive === 'only' ? asReflexive(lemma) : lemma;
        if (e && isNewWord(e, t.text)) {
          const key = e.term.toLowerCase();
          if (!out.has(key) && !vocab.value!.has(key)) {
            out.set(key, { entry: e, context: sentenceAt(headingText(paragraphs[pi]), offset) });
          }
        }
        offset += t.text.length;
      });
    });
    return out;
  });

  // ---------- Tapping a word ----------

  let sheetOpen = $state(false);
  /** The tapped word; for a split or reflexive verb, `word` is the joined verb and `group` its tokens. */
  let sel = $state<{ p: number; t: number; word: string; group: VerbGroup | null; context: string; key: number } | null>(null);
  let selKey = 0;

  const isSel = (p: number, t: number) => sheetOpen && sel?.p === p && (sel.t === t || !!sel.group?.tokens.includes(t));

  function onTap(e: MouseEvent) {
    const span = (e.target as Element | null)?.closest?.<HTMLElement>('[data-t]');
    const para = span?.closest<HTMLElement>('[data-p]');
    if (!span || !para) return;
    const p = Number(para.dataset.p);
    const t = Number(span.dataset.t);
    const tok = tokens[p]?.[t];
    if (!tok?.word) return;
    const group = groupAt(p, t) ?? null;
    // The context is the verb's sentence, whichever token of the group was tapped.
    const at = group ? group.verb : t;
    const offset = tokens[p].slice(0, at).reduce((n, x) => n + x.text.length, 0);
    const context = sentenceAt(headingText(paragraphs[p]), offset);
    sel = { p, t, word: group ? group.entry.term : tok.text, group, context, key: ++selKey };
    sheetOpen = true;
  }

  // ---------- Reading position ----------

  let textEl = $state<HTMLElement | undefined>();
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSaved = -1;

  /** Set by "Stop reading" so a pending scroll measurement doesn't save a position again. */
  let stopped = false;

  function measure() {
    if (stopped || !textEl || !row.value) return;
    const els = textEl.querySelectorAll<HTMLElement>('[data-p]');
    const bottom = window.innerHeight - 60;
    let idx = 0;
    for (let i = 0; i < els.length; i++) {
      if (els[i].getBoundingClientRect().top < bottom) idx = i;
      else break;
    }
    if (idx !== lastSaved) {
      lastSaved = idx;
      void setProgress(id, idx).catch(() => {});
    }
  }

  function onScroll() {
    if (scrollTimer) return;
    scrollTimer = setTimeout(() => {
      scrollTimer = undefined;
      measure();
    }, 700);
  }

  $effect(() => () => {
    clearTimeout(scrollTimer);
    stopSpeaking();
  });

  async function restorePosition(progress: number, readAt: number) {
    lastSaved = progress;
    if (!progress || readAt) return;
    await tick();
    const el = textEl?.querySelector<HTMLElement>(`[data-p="${progress}"]`);
    if (el && progress < paragraphs.length - 1) el.scrollIntoView({ block: 'end' });
  }

  // ---------- Footer actions ----------

  const isSaved = $derived(!!row.value?.savedAt);
  const isRead = $derived(!!row.value?.readAt);
  const setId = $derived(row.value?.setId ?? 0);
  const info = $derived(article ? sourceInfo(article.source) : null);
  const licenseUrl = $derived(article ? LICENSE_URLS[article.license] : undefined);

  let next = $state<{ id: string; title: string } | null>(null);
  $effect(() => {
    if (article?.source !== 'gutenberg') return;
    void nextPart(article.id)
      .then((n) => (next = n))
      .catch(() => {});
  });

  let adding = $state<{ done: number; total: number } | null>(null);

  async function addAllUnknown() {
    if (!article || adding) return;
    const list = [...unknown.values()];
    if (!list.length) return;
    const name = articleSetName(article.title);
    const ok = await confirmAction({
      title: `Add ${list.length} ${list.length === 1 ? 'word' : 'words'}?`,
      message: `New words from this text (not yet in any of your sets) go to «${name}» in the Reading folder.`,
      confirmLabel: 'Add',
    });
    if (!ok) return;
    adding = { done: 0, total: list.length };
    try {
      const sid = await ensureArticleSet($state.snapshot(article) as Article);
      const cards: Card[] = list.map(({ entry, context }) => buildCard(sid, entryFields(entry, settings.lang), context));
      showToast(`Adding ${cards.length} words…`, { timeout: 2000 });
      for (let i = 0; i < cards.length; i += 50) {
        await addCards(cards.slice(i, i + 50));
        adding = { done: Math.min(cards.length, i + 50), total: cards.length };
      }
      const missing = cards.filter((c) => c.needsFill).length;
      showToast(
        `Added ${cards.length} ${cards.length === 1 ? 'word' : 'words'} to «${name}»${missing ? ` · ${missing} to fill in` : ''}`,
        { actionLabel: 'Open set', onAction: () => go(`/set/${sid}`) },
      );
    } catch (e) {
      showToast(`Couldn’t add the words: ${(e as Error).message}`);
    } finally {
      adding = null;
    }
  }

  async function toggleRead() {
    if (!article) return;
    if (!row.value) await trackOpen($state.snapshot(article) as Article);
    await markRead(id, !isRead);
    if (!isRead) showToast('Marked as read');
  }

  const hasProgress = $derived(!!row.value?.progress && !row.value.readAt);

  async function stopReadingArticle() {
    const progress = row.value?.progress ?? 0;
    stopped = true;
    clearTimeout(scrollTimer);
    await stopReading(id);
    showToast('Stopped reading', { actionLabel: 'Undo', onAction: () => void setProgress(id, progress) });
    back('/read');
  }

  async function toggleSaved() {
    if (!article) return;
    if (article.source === 'paste') {
      const ok = await confirmAction({ title: 'Delete this text?', message: 'Its word set stays in your library.', confirmLabel: 'Delete', destructive: true });
      if (!ok) return;
      await deleteArticle(id);
      back('/read');
      return;
    }
    if (isSaved) {
      await removeFromSaved(id);
      showToast('Removed from saved');
    } else {
      await saveForOffline($state.snapshot(article) as Article);
      showToast('Saved for offline reading');
    }
  }

  function speakParagraph(i: number) {
    speak(headingText(paragraphs[i]));
  }
</script>

<svelte:window onscroll={onScroll} />

<div class="page reader">
  <div class="reader-head">
    <Header title={article?.title ?? (error ? 'Article' : '')} subtitle={info?.name ?? ''} backTo="/read" />
  </div>

  {#if error}
    {#if removed}
      <EmptyState icon="search" title="Article removed" text={error}>
        <button class="btn btn-primary" onclick={() => back('/read')}>Back to Read</button>
      </EmptyState>
    {:else}
      <EmptyState icon="refresh" title="Couldn’t open the article" text={error}>
        <button class="btn btn-primary" onclick={() => attempt++}>Try again</button>
        <button class="btn" onclick={() => back('/read')}>Back to Read</button>
      </EmptyState>
    {/if}
  {:else if !article}
    <div class="text-col">
      <Skeleton lines={5} />
      <div class="gap"></div>
      <Skeleton lines={4} />
    </div>
  {:else}
    <div class="meta" in:fade={{ duration: dur(200) }}>
      {#if level}<span class="pill level" title="Estimated level">{level}</span>{/if}
      {#if share !== null}
        <span class="pill known" title="Words you have learned or marked as known">{Math.round(share * 100)}% words you know</span>
      {/if}
      <span class="muted small">{minutes} min · {wordCount.toLocaleString()} words</span>
      {#if isRead}<span class="pill done"><Icon name="check" size={14} /> Read</span>{/if}
    </div>

    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <article class="text-col text" lang="de" bind:this={textEl} onclick={onTap}>
      {#each tokens as list, pi (pi)}
        {#if isHeading(paragraphs[pi])}
          <h2 class="para heading" data-p={pi}>{#each list as t, ti}{#if t.word}<span class="w {classOf(pi, ti, t.text)}" class:sel={isSel(pi, ti)} data-t={ti}>{t.text}</span>{:else}{t.text}{/if}{/each}</h2>
        {:else}
          <p class="para" data-p={pi}>{#each list as t, ti}{#if t.word}<span class="w {classOf(pi, ti, t.text)}" class:sel={isSel(pi, ti)} data-t={ti}>{t.text}</span>{:else}{t.text}{/if}{/each}<button
              class="say"
              type="button"
              aria-label="Read paragraph aloud"
              onclick={(e) => {
                e.stopPropagation();
                speakParagraph(pi);
              }}><Icon name="speaker" size={15} /></button
            ></p>
        {/if}
      {/each}
    </article>

    {#if !lemmas}
      <p class="muted small center analysing">Looking up words…</p>
    {/if}

    <footer class="text-col footer">
      {#if next}
        <button class="card pressable next" onclick={() => go(articlePath(next!.id))}>
          <span class="muted small">Next part</span>
          <span class="next-title" lang="de">{next.title}</span>
          <Icon name="chevron" size={18} />
        </button>
      {/if}

      <button class="btn btn-primary btn-block" onclick={addAllUnknown} disabled={!lemmas || !unknown.size || !!adding}>
        {#if adding}
          Adding… {adding.done}/{adding.total}
        {:else if !lemmas}
          Add all new words
        {:else}
          <Icon name="plus" size={18} /> Add all new words ({unknown.size})
        {/if}
      </button>
      {#if setId}
        <button class="btn btn-block btn-ghost" onclick={() => go(`/set/${setId}`)}>
          <Icon name="cards" size={18} /> Open «{articleSetName(article.title)}»
        </button>
      {/if}
      <div class="two">
        <button class="btn" class:on={isRead} onclick={toggleRead}>
          <Icon name="check" size={18} />{isRead ? 'Read' : 'Mark as read'}
        </button>
        <button class="btn" class:danger={article.source === 'paste'} onclick={toggleSaved}>
          {#if article.source === 'paste'}
            <Icon name="trash" size={18} />Delete text
          {:else if isSaved}
            <Icon name="x" size={18} />Remove from saved
          {:else}
            <Icon name="import" size={18} />Save for offline
          {/if}
        </button>
      </div>
      {#if hasProgress}
        <button class="btn btn-block btn-ghost" onclick={stopReadingArticle}>
          <Icon name="x" size={18} /> Stop reading
        </button>
      {/if}

      {#if article.source !== 'paste'}
        <p class="attribution small muted">
          “{article.title}” · {article.attribution.replace(` · ${article.license}`, '')} ·
          {#if licenseUrl}<a href={licenseUrl} target="_blank" rel="noopener noreferrer">{article.license}</a>{:else}{article.license}{/if}
          {#if article.url}
            · <a href={article.url} target="_blank" rel="noopener noreferrer">Open original</a>
          {/if}
          {#if article.license.startsWith('CC')}<br /><span class="tiny">Authors: see the version history of the original. Text shortened and reformatted for reading.</span>{/if}
        </p>
      {/if}
    </footer>
  {/if}
</div>

<Sheet bind:open={sheetOpen} title="Word">
  {#if sel && article}
    {#key sel.key}
      <WordSheet
        word={sel.word}
        written={sel.group ? groupText(tokens[sel.p], sel.group) : undefined}
        entry={sel.group ? sel.group.entry : (lemmas?.get(sel.word) ?? null)}
        context={sel.context}
        {article}
        {setId}
        cards={sel.group ? cardsOfEntry(sel.group.entry) : cardsOf(sel.word)}
        cardsOfTerm={cardsOfWord}
        onclose={() => (sheetOpen = false)}
      />
    {/key}
  {/if}
</Sheet>

<style>
  .reader-head :global(h1) {
    white-space: normal;
    font-family: var(--font-read);
    font-weight: 700;
    letter-spacing: 0;
    font-size: 26px;
    line-height: 1.2;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
  }
  .text-col {
    max-width: 38em;
    margin: 0 auto;
  }
  .gap {
    height: 20px;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: -2px 0 16px;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 700;
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--hairline);
  }
  .pill.level {
    font-family: var(--font-display);
    font-weight: 900;
    background: var(--accent-fill);
    color: var(--accent-text);
    box-shadow: none;
  }
  .pill.known {
    background: color-mix(in srgb, var(--good) 16%, transparent);
    color: var(--good);
  }
  .pill.done {
    color: var(--good);
  }
  .text {
    font-family: var(--font-read);
    font-size: 19.5px;
    line-height: 1.62;
    color: var(--text-read);
    hyphens: auto;
    -webkit-hyphens: auto;
    overflow-wrap: break-word;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }
  .para {
    margin: 0 0 1em;
  }
  .heading {
    font-family: var(--font-display);
    font-size: 21px;
    font-weight: 800;
    color: var(--text);
    margin: 1.4em 0 0.5em;
  }
  .w {
    border-radius: 5px;
    cursor: pointer;
    transition: background-color var(--dur-fast) var(--ease);
  }
  .w.u {
    text-decoration: underline dotted;
    text-decoration-color: color-mix(in srgb, var(--muted) 70%, transparent);
    text-decoration-thickness: 1.5px;
    text-underline-offset: 4px;
  }
  .w.l {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .w.sel {
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 28%, transparent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 28%, transparent);
  }
  .say {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    margin-left: 4px;
    vertical-align: -6px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    opacity: 0.75;
  }
  .say:active {
    background: var(--surface-2);
    color: var(--accent);
  }
  .analysing {
    margin: 0 0 12px;
  }
  .footer {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 12px;
    padding-top: 18px;
    border-top: 1px solid var(--hairline);
  }
  .next {
    display: flex;
    align-items: center;
    gap: 8px;
    border: 0;
    width: 100%;
    text-align: left;
    color: var(--muted);
    flex-wrap: wrap;
  }
  .next-title {
    flex: 1;
    min-width: 0;
    color: var(--text);
    font-family: var(--font-display);
    font-weight: 800;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .two .btn {
    font-size: 15px;
    padding-left: 8px;
    padding-right: 8px;
  }
  .btn.on {
    color: var(--good);
  }
  .btn.danger {
    color: var(--bad);
  }
  .attribution {
    margin: 8px 4px 0;
    line-height: 1.45;
  }
  .attribution a {
    color: var(--accent);
  }
  .tiny {
    font-size: 12px;
  }
</style>
