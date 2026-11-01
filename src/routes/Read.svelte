<script lang="ts">
  import { untrack } from 'svelte';
  import { fly } from 'svelte/transition';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import EmptyState from '../components/library/EmptyState.svelte';
  import ArticleRow from '../components/reading/ArticleRow.svelte';
  import FilterChips from '../components/reading/FilterChips.svelte';
  import LevelChips from '../components/reading/LevelChips.svelte';
  import { go } from '../lib/router.svelte';
  import { live } from '../lib/live.svelte';
  import { dur } from '../lib/motion';
  import { online } from '../lib/online.svelte';
  import { settings } from '../lib/settings.svelte';
  import { db } from '../lib/db/schema';
  import { fmtNumber, t, tn } from '../lib/i18n.svelte';
  import { LEVELS, type LevelCode } from '../lib/levels/types';
  import { feedErrorText, feeds, filterNews, interleave, loadFeed, loadNews, mergeNews, news, newsDate, newsSearch, readUi, resetFeed, searchNews } from '../lib/reading/feed.svelte';
  import { NEWS_SOURCE_IDS, NEWS_TOPICS, sourceInfo, sourcesForLevel } from '../lib/reading/sources';
  import { articlePath, articleTitle, pruneTracked, setProgress, stopReading } from '../lib/reading/store';
  import { showToast } from '../lib/ui/dialogs.svelte';
  import { firstSentence, isHeading } from '../lib/reading/text';
  import type { ArticleSummary, NewsTopic, ReadingSourceId, SavedArticle } from '../lib/reading/types';

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
    if (readUi.view === 'articles') untrack(() => void loadFeed(l));
  });

  // News update when the view opens, and when the app comes back with this view showing.
  $effect(() => {
    if (readUi.view !== 'news') return;
    untrack(() => void loadNews());
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadNews();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
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

  const newsFeeds = $derived(NEWS_SOURCE_IDS.map((id) => ({ id, f: news[id] })));
  const searching = $derived(!!newsSearch.query);
  const newsPool = $derived(searching ? newsSearch.items : mergeNews(newsFeeds.map(({ f }) => f.items)));
  const newsItems = $derived(filterNews(newsPool, readUi.newsSource, readUi.newsTopic));
  const newsLoading = $derived(searching ? newsSearch.loading : newsFeeds.some(({ f }) => f.loading || !f.loadedAt));
  const newsErrors = $derived(searching ? newsSearch.errors : newsFeeds.flatMap(({ id, f }) => (f.error ? [{ id, error: f.error }] : [])));
  const newsFailed = $derived(!newsLoading && newsItems.length === 0 && newsErrors.length === newsFeeds.length);
  const newsSources = $derived(NEWS_SOURCE_IDS.map((id) => sourceInfo(id).name).join(', '));

  const sourceChips = $derived([{ id: '', label: t('reading.news.all') }, ...NEWS_SOURCE_IDS.map((id) => ({ id, label: sourceInfo(id).short ?? sourceInfo(id).name }))]);
  // Only the topics there's something for (and the chosen one, so it can be unchosen).
  const topicChips = $derived.by(() => {
    const present = new Set(filterNews(newsPool, readUi.newsSource, '').map((a) => a.topic));
    const topics = NEWS_TOPICS.filter((id) => present.has(id) || id === readUi.newsTopic);
    return [{ id: '', label: t('reading.news.all') }, ...topics.map((id) => ({ id, label: t(`reading.news.topic.${id}`) }))];
  });

  let searchText = $state(newsSearch.query);

  function submitSearch(e: SubmitEvent) {
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur();
    void searchNews(searchText);
  }

  function clearSearch() {
    searchText = '';
    void searchNews('');
  }

  function refreshNews() {
    void (searching ? searchNews(newsSearch.query) : loadNews(true));
  }

  const newsMeta = (a: ArticleSummary) => [newsDate(a.publishedAt!), a.topic ? t(`reading.news.topic.${a.topic}`) : ''].filter(Boolean).join(' · ');

  const isNews = $derived(readUi.view === 'news');
</script>

<div class="page">
  <Header title={t('reading.read.title')}>
    {#snippet actions()}
      {#if isNews}
        <button class="icon-btn" aria-label={t('reading.news.refresh')} onclick={refreshNews} disabled={newsLoading}><Icon name="refresh" /></button>
      {:else}
        <button class="icon-btn" aria-label={t('reading.read.newArticles')} onclick={refresh} disabled={loading}><Icon name="refresh" /></button>
      {/if}
    {/snippet}
  </Header>

  <div class="segmented views" role="group" aria-label={t('reading.read.views')}>
    <button type="button" class:active={!isNews} aria-pressed={!isNews} onclick={() => (readUi.view = 'articles')}>{t('reading.read.viewArticles')}</button>
    <button type="button" class:active={isNews} aria-pressed={isNews} onclick={() => (readUi.view = 'news')}>{t('reading.read.viewNews')}</button>
  </div>

  {#if isNews}
    <form class="news-search" role="search" onsubmit={submitSearch}>
      <Icon name="search" size={18} />
      <input
        type="text"
        enterkeyhint="search"
        autocomplete="off"
        lang="de"
        aria-label={t('reading.news.search')}
        placeholder={t('reading.news.search')}
        bind:value={searchText}
        oninput={() => searchText === '' && clearSearch()}
      />
      {#if searchText}
        <button type="button" class="icon-btn" aria-label={t('reading.news.clearSearch')} onclick={clearSearch}><Icon name="x" size={16} /></button>
      {/if}
    </form>
    <FilterChips label={t('reading.news.sourceFilter')} options={sourceChips} value={readUi.newsSource} onpick={(id) => (readUi.newsSource = id as ReadingSourceId | '')} />
    <FilterChips label={t('reading.news.topicFilter')} options={topicChips} value={readUi.newsTopic} onpick={(id) => (readUi.newsTopic = id as NewsTopic | '')} />
    {#if !searching}<p class="level-hint muted small">{t('reading.news.hint', { sources: newsSources })}</p>{/if}
  {:else}
    <LevelChips bind:value={level} onchange={choose} />
    <p class="level-hint muted small">{t(`level.${level}.title`)} · {sourceNames}</p>
  {/if}

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

  {#if isNews}
    <section class="section">
      <h2 class="section-title">{searching ? t('reading.news.results', { query: newsSearch.query }) : t('reading.news.title')}</h2>

      {#if newsErrors.length && !newsFailed}
        <div class="notes">
          {#each newsErrors as { id, error } (id)}
            <p class="note"><span>{feedErrorText(id, error)}</span><button class="btn-link" onclick={refreshNews}>{t('reading.read.retry')}</button></p>
          {/each}
        </div>
      {/if}

      {#if newsLoading && newsItems.length === 0}
        <div class="card"><Skeleton lines={4} /></div>
        <div class="card skel2"><Skeleton lines={3} /></div>
      {:else if newsFailed}
        <EmptyState
          icon="refresh"
          title={online.value ? t('reading.news.loadFailed') : t('reading.read.offline')}
          text={online.value ? t('reading.news.sourcesDown') : t('reading.read.offlineHint')}
        >
          <button class="btn btn-primary" onclick={refreshNews}>{t('common.retry')}</button>
        </EmptyState>
      {:else if newsItems.length === 0}
        <EmptyState icon="search" title={t('reading.read.emptyTitle')} text={searching ? t('reading.news.noResults') : newsPool.length ? t('reading.news.noMatch') : t('reading.news.empty')}>
          {#if !searching && !newsPool.length}
            <button class="btn" onclick={refreshNews}>{t('reading.read.refresh')}</button>
          {/if}
        </EmptyState>
      {:else}
        <div class="list">
          {#each newsItems as a (a.id)}
            {@const row = byId.get(a.id)}
            <ArticleRow
              id={a.id}
              source={a.source}
              title={row?.title ?? a.title}
              snippet={a.snippet}
              level={row?.level ?? ''}
              meta={newsMeta(a)}
              progress={row ? ratio(row) : 0}
              read={!!row?.readAt}
            />
          {/each}
        </div>
      {/if}
    </section>
  {:else}
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
  {/if}

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
  .views {
    margin-bottom: 12px;
  }
  .views button {
    flex: 1;
  }
  .news-search {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    margin-bottom: 10px;
    padding: 0 6px 0 12px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--muted);
  }
  .news-search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 16px;
  }
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
