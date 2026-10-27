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
  import { LEVELS, LEVEL_TITLES, type LevelCode } from '../lib/levels/types';
  import { feeds, interleave, loadFeed, readUi, resetFeed } from '../lib/reading/feed.svelte';
  import { sourceInfo, sourcesForLevel } from '../lib/reading/sources';
  import { articlePath, pruneTracked } from '../lib/reading/store';
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
  const canLoadMore = $derived(sourceFeeds.some(({ f }) => f && !f.done && !f.error && f.items.length));
  const allFailed = $derived(!loading && items.length === 0 && errors.length === sourceIds.length);

  const ratio = (a: SavedArticle) => (a.paragraphs?.length ? Math.min(1, a.progress / a.paragraphs.length) : 0);
  const snippetOf = (a: SavedArticle) => firstSentence(a.paragraphs?.find((p) => !isHeading(p)) ?? '');

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
  <Header title="Read">
    {#snippet actions()}
      <button class="icon-btn" aria-label="New articles" onclick={refresh} disabled={loading}><Icon name="refresh" /></button>
    {/snippet}
  </Header>

  <LevelChips bind:value={level} onchange={choose} />
  <p class="level-hint muted small">{LEVEL_TITLES[level]} · {sourceNames}</p>

  {#if continuing}
    <button class="card pressable continue" onclick={() => continuing && go(articlePath(continuing.id))} in:fly={{ y: 8, duration: dur(220) }}>
      <span class="eyebrow">Continue reading</span>
      <span class="c-title" lang="de">{continuing.title}</span>
      <span class="c-bar" aria-hidden="true"><span style:width="{ratio(continuing) * 100}%"></span></span>
    </button>
  {/if}

  <button class="card pressable paste" onclick={() => go('/paste')}>
    <span class="paste-icon"><Icon name="edit" size={20} /></span>
    <span class="paste-text">
      <span class="p-title">Paste your own text</span>
      <span class="muted small">A news article, an email, a school text… tap any word to look it up.</span>
    </span>
    <Icon name="chevron" size={18} />
  </button>

  <section class="section">
    <h2 class="section-title">Articles · {level}</h2>

    {#if errors.length && !allFailed}
      <div class="notes">
        {#each errors as { id, f } (id)}
          <p class="note"><span>{f?.error}</span><button class="btn-link" onclick={retry}>Retry</button></p>
        {/each}
      </div>
    {/if}

    {#if firstLoad}
      <div class="card"><Skeleton lines={4} /></div>
      <div class="card skel2"><Skeleton lines={3} /></div>
    {:else if allFailed}
      <EmptyState
        icon="refresh"
        title={online.value ? 'Couldn’t load articles' : 'You’re offline'}
        text={online.value ? 'The sources for this level are unavailable right now.' : 'Saved articles and your own texts still work.'}
      >
        <button class="btn btn-primary" onclick={retry}>Try again</button>
      </EmptyState>
    {:else if items.length === 0}
      <EmptyState icon="search" title="Nothing here yet" text="No articles for this level right now. Try another level or paste your own text.">
        <button class="btn" onclick={refresh}>Refresh</button>
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
            level={row?.level || a.level || ''}
            progress={row ? ratio(row) : 0}
            read={!!row?.readAt}
          />
        {/each}
      </div>
      {#if canLoadMore || loading}
        <button class="btn btn-block more" onclick={loadMore} disabled={loading}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      {/if}
    {/if}
  </section>

  {#if saved.length}
    <section class="section">
      <h2 class="section-title">Saved <span>{saved.length}</span></h2>
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
    Texts: MiniKlexikon &amp; Klexikon (CC BY-SA 4.0), Wikinews (CC BY 2.5), Wikipedia (CC BY-SA 4.0),
    Project Gutenberg (public domain). Attribution is shown under every article.
  </p>
</div>

<style>
  .level-hint {
    margin: 8px 4px 0;
  }
  .continue {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    margin-top: 16px;
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
