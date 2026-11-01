<script lang="ts">
  import { untrack } from 'svelte';
  import { fly } from 'svelte/transition';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import EmptyState from '../components/library/EmptyState.svelte';
  import ArticleRow from '../components/reading/ArticleRow.svelte';
  import LevelChips from '../components/reading/LevelChips.svelte';
  import { go } from '../lib/router.svelte';
  import { live } from '../lib/live.svelte';
  import { dur } from '../lib/motion';
  import { online } from '../lib/online.svelte';
  import { settings } from '../lib/settings.svelte';
  import { db } from '../lib/db/schema';
  import { fmtNumber, t, tn } from '../lib/i18n.svelte';
  import { LEVELS, type LevelCode } from '../lib/levels/types';
  import { feedErrorText, feeds, interleave, loadFeed, readUi, resetFeed } from '../lib/reading/feed.svelte';
  import { sourceInfo, sourcesForLevel } from '../lib/reading/sources';
  import { articlePath, articleTitle, pruneTracked, setProgress, stopReading } from '../lib/reading/store';
  import { showToast } from '../lib/ui/dialogs.svelte';
  import { firstSentence, isHeading } from '../lib/reading/text';
  import type { ReadingSourceId, SavedArticle } from '../lib/reading/types';

  /** Default: the level the user is focusing on (settings.focus "level/B1"), else A2. */
  function defaultLevel(): LevelCode {
    const m = /^level\/([ABC][12])$/.exec(settings.focus);
    return m && (LEVELS as string[]).includes(m[1]) ? (m[1] as LevelCode) : 'A2';
  }

  let level = $state<LevelCode>(readUi.level ?? defaultLevel());

  // Settings load asynchronously: follow the focus level until the user picks one.
  $effect(() => {
    if (!readUi.level) level = defaultLevel();
  });

  $effect(() => {
    const l = level;
    untrack(() => void loadFeed(l));
  });

  // Housekeeping: forget articles that were only opened, long ago.
  $effect(() => {
    void pruneTracked().catch(() => {});
  });

  function choose(l: LevelCode) {
    readUi.level = l;
  }

  const rows = live(() => db.articles.toArray());
  const byId = $derived(new Map((rows.value ?? []).map((a) => [a.id, a])));

  const saved = $derived(
    (rows.value ?? []).filter((a) => a.savedAt > 0).sort((a, b) => b.savedAt - a.savedAt),
  );
  const recency = (a: SavedArticle) => a.openedAt ?? a.savedAt ?? 0;
  const continuing = $derived(
    (rows.value ?? [])
      .filter((a) => !a.readAt && a.progress > 0)
      .sort((a, b) => recency(b) - recency(a))[0],
  );

  const feed = $derived(feeds[level]);
  const sourceIds = $derived(sourcesForLevel(level).map((s) => s.id));
  const sourceFeeds = $derived(sourceIds.map((id) => ({ id, f: feed?.sources[id] })));
  const items = $derived(interleave(sourceFeeds.map(({ f }) => f?.items ?? [])));
  const loading = $derived(sourceFeeds.some(({ f }) => !f || f.loading));
  const firstLoad = $derived(loading && items.length === 0);
  const errors = $derived(sourceFeeds.filter(({ f }) => f?.error));
  // A live source whose batch had nothing at this level still has a next batch.
  const canLoadMore = $derived(sourceFeeds.some(({ f }) => f && !f.done && !f.error && f.cursor !== undefined));
  const allFailed = $derived(!loading && items.length === 0 && errors.length === sourceIds.length);

  /** Reading time for list rows whose length is known (same pace as the reader). */
  const minutesOf = (words: number | undefined) => (words ? tn('common.minutes', Math.max(1, Math.round(words / 120))) : '');
  const ratio = (a: SavedArticle) => (a.paragraphs?.length ? Math.min(1, a.progress / a.paragraphs.length) : 0);
  const snippetOf = (a: SavedArticle) => firstSentence(a.paragraphs?.find((p) => !isHeading(p)) ?? '');

  async function stopContinuing(a: SavedArticle) {
    const progress = a.progress;
    await stopReading(a.id);
    showToast(t('reading.read.stopped', { title: articleTitle(a) }), { actionLabel: t('common.undo'), onAction: () => void setProgress(a.id, progress) });
  }

  function retry() {
    void loadFeed(level, true);
  }

  function refresh() {
    resetFeed(level);
    void loadFeed(level);
  }

  function loadMore() {
    void loadFeed(level, true);
  }

  const sourceNames = $derived(sourceIds.map((id) => sourceInfo(id as ReadingSourceId).name).join(', '));
</script>

<div class="page">
  <Header title={t('reading.read.title')}>
    {#snippet actions()}
      <button class="icon-btn" aria-label={t('reading.read.newArticles')} onclick={refresh} disabled={loading}><Icon name="refresh" /></button>
    {/snippet}
  </Header>

  <LevelChips bind:value={level} onchange={choose} />
  <p class="level-hint muted small">{t(`level.${level}.title`)} · {sourceNames}</p>

  {#if continuing}
    <div class="continue-wrap" in:fly={{ y: 8, duration: dur(220) }}>
      <button class="card pressable continue" onclick={() => continuing && go(articlePath(continuing.id))}>
        <span class="eyebrow">{t('reading.read.continue')}</span>
        <span class="c-title" lang="de">{articleTitle(continuing)}</span>
        <span class="c-bar" aria-hidden="true"><span style:width="{ratio(continuing) * 100}%"></span></span>
      </button>
      <button class="icon-btn c-stop" aria-label={t('reading.stop')} title={t('reading.stop')} onclick={() => continuing && void stopContinuing(continuing)}>
        <Icon name="x" size={18} />
      </button>
    </div>
  {/if}

  <button class="card pressable paste" onclick={() => go('/paste')}>
    <span class="paste-icon"><Icon name="edit" size={20} /></span>
    <span class="paste-text">
      <span class="p-title">{t('reading.read.pasteTitle')}</span>
      <span class="muted small">{t('reading.read.pasteHint')}</span>
    </span>
    <Icon name="chevron" size={18} />
  </button>

  <section class="section">
    <h2 class="section-title">{t('reading.read.articles', { level })}</h2>

    {#if errors.length && !allFailed}
      <div class="notes">
        {#each errors as { id, f } (id)}
          <p class="note"><span>{feedErrorText(id, f?.error)}</span><button class="btn-link" onclick={retry}>{t('reading.read.retry')}</button></p>
        {/each}
      </div>
    {/if}

    {#if firstLoad}
      <div class="card"><Skeleton lines={4} /></div>
      <div class="card skel2"><Skeleton lines={3} /></div>
    {:else if allFailed}
      <EmptyState
        icon="refresh"
        title={online.value ? t('reading.read.loadFailed') : t('reading.read.offline')}
        text={online.value ? t('reading.read.sourcesDown') : t('reading.read.offlineHint')}
      >
        <button class="btn btn-primary" onclick={retry}>{t('common.retry')}</button>
      </EmptyState>
    {:else if items.length === 0}
      <EmptyState icon="search" title={t('reading.read.emptyTitle')} text={t('reading.read.emptyText')}>
        {#if canLoadMore}
          <button class="btn" onclick={loadMore}>{t('reading.read.loadMore')}</button>
        {:else}
          <button class="btn" onclick={refresh}>{t('reading.read.refresh')}</button>
        {/if}
      </EmptyState>
    {:else}
      <div class="list">
        {#each items as a (a.id)}
          {@const row = byId.get(a.id)}
          <ArticleRow
            id={a.id}
            source={a.source}
            title={row?.title ?? a.title}
            snippet={a.snippet}
            level={a.level || row?.level || ''}
            meta={minutesOf(a.words)}
            progress={row ? ratio(row) : 0}
            read={!!row?.readAt}
          />
        {/each}
      </div>
      {#if canLoadMore || loading}
        <button class="btn btn-block more" onclick={loadMore} disabled={loading}>
          {loading ? t('common.loading') : t('reading.read.loadMore')}
        </button>
      {/if}
    {/if}
  </section>

  {#if saved.length}
    <section class="section">
      <h2 class="section-title">{t('reading.read.saved')} <span>{fmtNumber(saved.length)}</span></h2>
      <div class="list">
        {#each saved as a (a.id)}
          <ArticleRow
            id={a.id}
            source={a.source}
            title={a.title}
            snippet={snippetOf(a)}
            level={a.level}
            progress={ratio(a)}
            read={!!a.readAt}
          />
        {/each}
      </div>
    </section>
  {/if}

  <p class="credits muted small">
    {t('reading.read.credits')}
  </p>
</div>

<style>
  .level-hint {
    margin: 8px 4px 0;
  }
  .continue-wrap {
    position: relative;
    margin-top: 16px;
  }
  .c-stop {
    position: absolute;
    top: 6px;
    right: 6px;
    color: var(--muted);
  }
  .continue {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    border: 0;
    text-align: left;
    color: inherit;
  }
  .eyebrow {
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .c-title {
    padding-right: 36px;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 18px;
    line-height: 1.25;
  }
  .c-bar {
    display: block;
    height: 6px;
    border-radius: 999px;
    background: var(--surface-2);
    overflow: hidden;
    margin-top: 8px;
  }
  .c-bar span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent-bar);
  }
  .paste {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    margin-top: 12px;
    border: 0;
    text-align: left;
    color: var(--muted);
  }
  .paste-icon {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 14px;
    background: color-mix(in srgb, var(--tier-b) 15%, transparent);
    color: var(--tier-b);
    flex-shrink: 0;
  }
  .paste-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .p-title {
    color: var(--text);
    font-family: var(--font-display);
    font-weight: 800;
  }
  .notes {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 10px;
  }
  .note {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 0;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--warn) 12%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warn) 22%, transparent);
    font-size: 14px;
  }
  .btn-link {
    border: 0;
    background: none;
    color: var(--accent);
    font-weight: 600;
    font-size: 14px;
    padding: 4px;
    cursor: pointer;
  }
  .skel2 {
    margin-top: 10px;
  }
  .more {
    margin-top: 12px;
  }
  .credits {
    margin: 28px 4px 0;
    line-height: 1.4;
  }
</style>
