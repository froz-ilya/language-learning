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
  import { fmtNumber, t, tn } from '../lib/i18n.svelte';
  import { db } from '../lib/db/schema';
  import { addCards } from '../lib/db/repo';
  import { speak, stopSpeaking } from '../lib/speech/tts';
  import type { LexEntry } from '../lib/dict/types';
  import { getArticle, knownLevel, LICENSE_URLS, sourceInfo } from '../lib/reading/sources';
  import { newsDate } from '../lib/reading/feed.svelte';
  import { GUTENBERG_LICENSE, nextPart } from '../lib/reading/sources/gutenberg';
  import { isRemovedError } from '../lib/reading/sources/klexikon';
  import { headingText, isHeading, sentenceAt, tokenize, countWords, type Token } from '../lib/reading/text';
  import { translateArticleExamples } from '../lib/reading/exampleTranslations';
  import { comfortRank, estimateLevel, isFunctionWord, knownShare, UNKNOWN_RANK } from '../lib/reading/level';
  import { rankLookup } from '../lib/reading/rate';
  import { splitGuess, splitVerbs, type SplitGuess, type SplitVerb } from '../lib/reading/separable';
  import { groupText, reflexiveVerbs, verbGroups, type ReflexiveVerb, type VerbGroup } from '../lib/reading/reflexive';
  import { cardsFor, cardsOfReading, cardsOfTerm, lemmaMap, loadVocab, type CardRef } from '../lib/reading/vocab';
  import { tokenReadings } from '../lib/reading/wordSense';
  import { asReflexive } from '../lib/german/reflexive';
  import { lookupWord } from '../lib/lookup/lookup';
  import { entryFields } from '../lib/search/wordInfo';
  import {
    articleIdFromParts,
    articlePath,
    articleSetName,
    articleTitle,
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
        if (!a.paragraphs.length) throw new Error(t('reading.reader.noText'));
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
        error = online.value ? e.message || t('reading.reader.loadFailed') : t('reading.reader.offlineNotSaved');
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

  /** Rare split verbs confirmed online after a tap, by paragraph. */
  let found = $state.raw<Record<number, VerbGroup[]>>({});

  /** Verbs written as several tokens, per paragraph: a reflexive verb wins over a split one sharing a token. */
  const groups = $derived(
    splits?.map((m, p) => {
      const out = verbGroups(m, reflexives?.[p]);
      for (const g of found[p] ?? []) for (const t of g.tokens) out.set(t, g);
      return out;
    }) ?? null,
  );

  /** The split or reflexive verb a token belongs to (as the verb, the particle or the pronoun). */
  const groupAt = (p: number, t: number): VerbGroup | undefined => groups?.[p]?.get(t);

  /** What each word means at its position (token index → readings, best first), for words with several; null until found. */
  let readings = $state.raw<Map<number, LexEntry[]>[] | null>(null);

  $effect(() => {
    const t = tokens;
    readings = null;
    if (!t.length) return;
    let cancelled = false;
    void tokenReadings(t).then((r) => {
      if (!cancelled) readings = r;
    });
    return () => {
      cancelled = true;
    };
  });

  /** The word's reading at this position, when it has several (else the spelling's entry in `lemmas` holds). */
  const readingAt = (p: number, t: number): LexEntry | undefined => readings?.[p]?.get(t)?.[0];

  const NO_LEMMAS = new Map<string, LexEntry | null>();
  const cardsOf = (w: string): CardRef[] => (vocab.value ? cardsFor(w, lemmas ?? NO_LEMMAS, vocab.value) : []);
  /** Cards for a term itself (a split verb's anrufen, "sich treffen"), not via the text's lemmas. */
  const cardsOfWord = (term: string): CardRef[] => cardsOfTerm(term, vocab.value);
  const cardsOfEntry = (e: LexEntry): CardRef[] => cardsOfWord(e.term);
  /** Cards for the word at a position, read as that position's best reading. */
  const cardsAt = (p: number, t: number, word: string): CardRef[] => {
    const e = readingAt(p, t);
    return e && vocab.value ? cardsOfReading(word, e, vocab.value) : cardsOf(word);
  };

  /** Words up to this rank count as familiar (the user's level); rarer ones are highlighted as new. */
  const comfort = $derived(comfortRank(settings.focus));
  const isNewWord = (e: LexEntry | null | undefined, word: string) =>
    e ? !isFunctionWord(e) && e.rank > comfort : /^\p{Ll}/u.test(word) && word.length > 2;

  /**
   * The class of a word from its cards and entry. Tint only words being studied; a card that's in
   * a set but never studied (e.g. a whole installed level) shouldn't light up every common word.
   */
  const colourOf = (refs: CardRef[], e: LexEntry | null | undefined, word: string) =>
    refs.length ? (refs[0].status === 'learning' ? 'l' : '') : isNewWord(e, word) ? 'u' : '';

  /** CSS class per distinct word: 'u' new (dotted), 'l' learning (tinted), '' familiar/known/function word. */
  const classes = $derived.by(() => {
    const map = new Map<string, string>();
    if (!vocab.value) return map;
    for (const t of allTokens) {
      if (!t.word || map.has(t.text)) continue;
      const refs = cardsOf(t.text);
      map.set(t.text, refs.length || lemmas ? colourOf(refs, lemmas?.get(t.text), t.text) : '');
    }
    return map;
  });

  /** Classes for the tokens of split and reflexive verbs, by paragraph and token index: coloured as the joined verb. */
  const groupClasses = $derived.by(() => {
    if (!groups || !vocab.value) return null;
    return groups.map((m) => {
      const out = new Map<number, string>();
      for (const g of new Set(m.values())) {
        const cls = colourOf(cardsOfEntry(g.entry), g.entry, g.entry.term);
        for (const t of g.tokens) out.set(t, cls);
      }
      return out;
    });
  });

  /** Classes of words read differently here than the spelling's usual reading, by paragraph and token index. */
  const readingClasses = $derived.by(() => {
    if (!readings || !lemmas || !vocab.value) return null;
    return readings.map((m, p) => {
      const out = new Map<number, string>();
      for (const [t, list] of m) {
        const text = tokens[p][t].text;
        const usual = lemmas!.get(text);
        if (list[0].term === usual?.term && list[0].pos === usual.pos) continue;
        out.set(t, colourOf(cardsAt(p, t, text), list[0], text));
      }
      return out;
    });
  });

  /** A verb group wins over the reading at the position, which wins over the spelling. 'g' marks a group's tokens. */
  const classOf = (p: number, t: number, text: string) => {
    const cls = groupClasses?.[p]?.get(t) ?? readingClasses?.[p]?.get(t) ?? classes.get(text) ?? '';
    return groupAt(p, t) ? `${cls} g` : cls;
  };

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
        const lemma = t.word ? (readingAt(pi, ti) ?? lemmas!.get(t.text)) : null;
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

  /** The readings of the tapped word at its position (none for a verb group). */
  const selReadings = $derived(sel && !sel.group ? readings?.[sel.p]?.get(sel.t) : undefined);

  /** The sentence of a token, for the sheet. */
  function contextAt(p: number, t: number) {
    const offset = tokens[p].slice(0, t).reduce((n, x) => n + x.text.length, 0);
    return sentenceAt(headingText(paragraphs[p]), offset);
  }

  /** Answers of the online lookup for a guessed split verb, by paragraph and tokens: asked once per article. */
  const guesses = new Map<string, Promise<VerbGroup | null>>();

  /** The guess as a verb group, when an online dictionary knows the verb. Failures count as not found. */
  function confirmGuess(p: number, guess: SplitGuess): Promise<VerbGroup | null> {
    const key = `${p}:${guess.verb}:${guess.particle}`;
    let answer = guesses.get(key);
    if (!answer) {
      const ids = [guess.verb, guess.particle, ...(guess.pronoun === undefined ? [] : [guess.pronoun])].sort((a, b) => a - b);
      answer = lookupWord(guess.term, settings.lang)
        .then((r) => {
          // A translation-only answer (Google) proves nothing: it translates any made-up verb.
          if (r?.pos !== 'verb' || r.source === 'google' || ids.some((t) => groupAt(p, t))) return null;
          const g: VerbGroup = {
            verb: guess.verb,
            tokens: ids,
            // No translation here: the sheet fills in everything from the cached online lookup.
            entry: { term: r.term, pos: 'verb', genders: [], plural: '', praeteritum: r.praeteritum, partizip2: r.partizip2, auxiliary: r.auxiliary, tr: { ru: '', en: '' }, rank: UNKNOWN_RANK },
          };
          found = { ...found, [p]: [...(found[p] ?? []), g] };
          return g;
        })
        .catch(() => null);
      guesses.set(key, answer);
    }
    return answer;
  }

  /** A word without a verb group may be a split verb too rare for the offline dictionary: try it, quietly. */
  async function tryGuess(p: number, t: number, key: number) {
    // Until the offline detectors are done, a guess could be a verb they are about to find.
    if (!reflexives) return;
    const guess = splitGuess(tokens[p], t);
    if (!guess || !(online.value || guesses.has(`${p}:${guess.verb}:${guess.particle}`))) return;
    const group = await confirmGuess(p, guess);
    if (group && key === selKey && sheetOpen) sel = { p, t, word: group.entry.term, group, context: contextAt(p, group.verb), key: ++selKey };
  }

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
    const context = contextAt(p, group ? group.verb : t);
    const key = ++selKey;
    sel = { p, t, word: group ? group.entry.term : tok.text, group, context, key };
    sheetOpen = true;
    if (!group) void tryGuess(p, t, key);
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
  const subtitle = $derived([info?.name, article?.publishedAt ? newsDate(article.publishedAt) : ''].filter(Boolean).join(' · '));
  const licenseUrl = $derived(article ? LICENSE_URLS[article.license] : undefined);
  const licenseName = $derived(article?.license === GUTENBERG_LICENSE ? t('reading.reader.gutenbergLicense') : article?.license);
  const setName = $derived(article ? articleSetName(articleTitle(article)) : '');

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
    const ok = await confirmAction({
      title: tn('reading.reader.addWords', list.length),
      message: t('reading.reader.addWordsText', { set: setName }),
      confirmLabel: t('common.add'),
    });
    if (!ok) return;
    adding = { done: 0, total: list.length };
    try {
      const sid = await ensureArticleSet($state.snapshot(article) as Article);
      const cards: Card[] = list.map(({ entry, context }) => buildCard(sid, entryFields(entry, settings.lang), context));
      showToast(tn('reading.reader.addingWords', cards.length), { timeout: 2000 });
      for (let i = 0; i < cards.length; i += 50) {
        await addCards(cards.slice(i, i + 50));
        adding = { done: Math.min(cards.length, i + 50), total: cards.length };
      }
      void translateArticleExamples(settings.lang);
      const missing = cards.filter((c) => c.needsFill).length;
      showToast(
        missing ? tn('reading.reader.addedMissing', cards.length, { set: setName, missing }) : tn('reading.reader.added', cards.length, { set: setName }),
        { actionLabel: t('reading.openSet'), onAction: () => go(`/set/${sid}`) },
      );
    } catch (e) {
      showToast(t('reading.reader.addFailed', { error: (e as Error).message }));
    } finally {
      adding = null;
    }
  }

  async function toggleRead() {
    if (!article) return;
    if (!row.value) await trackOpen($state.snapshot(article) as Article);
    await markRead(id, !isRead);
    if (!isRead) showToast(t('reading.reader.markedRead'));
  }

  const hasProgress = $derived(!!row.value?.progress && !row.value.readAt);

  async function stopReadingArticle() {
    const progress = row.value?.progress ?? 0;
    stopped = true;
    clearTimeout(scrollTimer);
    await stopReading(id);
    showToast(t('reading.reader.stopped'), { actionLabel: t('common.undo'), onAction: () => void setProgress(id, progress) });
    back('/read');
  }

  async function toggleSaved() {
    if (!article) return;
    if (article.source === 'paste') {
      const ok = await confirmAction({ title: t('reading.reader.deleteTitle'), message: t('reading.reader.deleteText'), confirmLabel: t('common.delete'), destructive: true });
      if (!ok) return;
      await deleteArticle(id);
      back('/read');
      return;
    }
    if (isSaved) {
      await removeFromSaved(id);
      showToast(t('reading.reader.removedSaved'));
    } else {
      await saveForOffline($state.snapshot(article) as Article);
      showToast(t('reading.reader.savedOffline'));
    }
  }

  function speakParagraph(i: number) {
    speak(headingText(paragraphs[i]));
  }
</script>

<svelte:window onscroll={onScroll} />

<div class="page reader">
  <div class="reader-head">
    <Header title={article ? articleTitle(article) : error ? t('reading.reader.article') : ''} subtitle={subtitle} backTo="/read" />
  </div>

  {#if error}
    {#if removed}
      <EmptyState icon="search" title={t('reading.reader.removed')} text={error}>
        <button class="btn btn-primary" onclick={() => back('/read')}>{t('reading.reader.backToRead')}</button>
      </EmptyState>
    {:else}
      <EmptyState icon="refresh" title={t('reading.reader.openFailed')} text={error}>
        <button class="btn btn-primary" onclick={() => attempt++}>{t('common.retry')}</button>
        <button class="btn" onclick={() => back('/read')}>{t('reading.reader.backToRead')}</button>
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
      {#if level}<span class="pill level" title={t('reading.reader.estimatedLevel')}>{level}</span>{/if}
      {#if share !== null}
        <span class="pill known" title={t('reading.reader.knownHint')}>{t('reading.reader.known', { n: Math.round(share * 100) })}</span>
      {/if}
      <span class="muted small">{tn('common.minutes', minutes)} · {tn('common.words', wordCount)}</span>
      {#if isRead}<span class="pill done"><Icon name="check" size={14} /> {t('reading.status.read')}</span>{/if}
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
              aria-label={t('reading.reader.readAloud')}
              onclick={(e) => {
                e.stopPropagation();
                speakParagraph(pi);
              }}><Icon name="speaker" size={15} /></button
            ></p>
        {/if}
      {/each}
    </article>

    {#if !lemmas}
      <p class="muted small center analysing">{t('reading.reader.lookingUp')}</p>
    {/if}

    <footer class="text-col footer">
      {#if next}
        <button class="card pressable next" onclick={() => go(articlePath(next!.id))}>
          <span class="muted small">{t('reading.reader.nextPart')}</span>
          <span class="next-title" lang="de">{next.title}</span>
          <Icon name="chevron" size={18} />
        </button>
      {/if}

      <button class="btn btn-primary btn-block" onclick={addAllUnknown} disabled={!lemmas || !unknown.size || !!adding}>
        {#if adding}
          {t('reading.reader.adding', { done: adding.done, total: adding.total })}
        {:else if !lemmas}
          {t('reading.reader.addAll')}
        {:else}
          <Icon name="plus" size={18} /> {t('reading.reader.addAllCount', { n: unknown.size })}
        {/if}
      </button>
      {#if setId}
        <button class="btn btn-block btn-ghost" onclick={() => go(`/set/${setId}`)}>
          <Icon name="cards" size={18} /> {t('reading.openNamed', { set: setName })}
        </button>
      {/if}
      <div class="two">
        <button class="btn" class:on={isRead} onclick={toggleRead}>
          <Icon name="check" size={18} />{isRead ? t('reading.status.read') : t('reading.reader.markRead')}
        </button>
        <button class="btn" class:danger={article.source === 'paste'} onclick={toggleSaved}>
          {#if article.source === 'paste'}
            <Icon name="trash" size={18} />{t('reading.reader.deleteButton')}
          {:else if isSaved}
            <Icon name="x" size={18} />{t('reading.reader.removeSaved')}
          {:else}
            <Icon name="import" size={18} />{t('reading.reader.saveOffline')}
          {/if}
        </button>
      </div>
      {#if hasProgress}
        <button class="btn btn-block btn-ghost" onclick={stopReadingArticle}>
          <Icon name="x" size={18} /> {t('reading.stop')}
        </button>
      {/if}

      {#if article.source !== 'paste'}
        <p class="attribution small muted">
          {t('reading.quoted', { text: article.title })} · {article.attribution.replace(` · ${article.license}`, '')} ·
          {#if licenseUrl}<a href={licenseUrl} target="_blank" rel="noopener noreferrer">{licenseName}</a>{:else}{licenseName}{/if}
          {#if article.url}
            · <a href={article.url} target="_blank" rel="noopener noreferrer">{t('reading.reader.openOriginal')}</a>
          {/if}
          {#if article.license.startsWith('CC')}<br /><span class="tiny">{t('reading.reader.authors')}</span>{/if}
        </p>
      {/if}
    </footer>
  {/if}
</div>

<Sheet bind:open={sheetOpen} title={t('reading.reader.wordSheet')}>
  {#if sel && article}
    {#key sel.key}
      <WordSheet
        word={sel.word}
        written={sel.group ? groupText(tokens[sel.p], sel.group) : undefined}
        entry={sel.group ? sel.group.entry : (selReadings?.[0] ?? lemmas?.get(sel.word) ?? null)}
        readings={selReadings}
        context={sel.context}
        {article}
        {setId}
        cards={sel.group ? cardsOfEntry(sel.group.entry) : cardsAt(sel.p, sel.t, sel.word)}
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
  /* One verb in several words: a thin solid line under each, drawn as a background so it stays
     next to the dotted 'u' underline and the 'l' tint and takes no space. */
  .w.g:not(.sel) {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }
  .w.g {
    background-image: linear-gradient(color-mix(in srgb, var(--accent) 60%, transparent) 0 0);
    background-repeat: no-repeat;
    background-position: 0 100%;
    background-size: 100% 1.5px;
  }
  .w.g.u {
    text-underline-offset: 2px;
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
