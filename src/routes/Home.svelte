<script lang="ts">
  import { fly } from 'svelte/transition';
  import Icon, { type IconName } from '../components/Icon.svelte';
  import ProgressRing from '../components/ProgressRing.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { createSet, focusInfo, quickAddWord, stagger } from '../components/library/actions';
  import { go, switchTab } from '../lib/router.svelte';
  import { db } from '../lib/db/schema';
  import type { SavedArticle } from '../lib/reading/types';
  import { live } from '../lib/live.svelte';
  import { dur } from '../lib/motion';
  import { settings } from '../lib/settings.svelte';
  import { smartCounts, type SmartId } from '../lib/study/sources';

  /** Seconds per word, for the "about N min" estimate. */
  const SECONDS_PER_WORD = 20;

  const data = live(async () => {
    const focus = settings.focus; // read synchronously so a focus change re-runs the query
    const [counts, info] = await Promise.all([smartCounts(), focus ? focusInfo(focus) : null]);
    return { counts, info, focus };
  });

  /** Most recent article that was started but not finished. */
  const reading = live(async () => {
    const started = await db.articles
      .where('readAt')
      .equals(0)
      .filter((a) => a.progress > 0)
      .toArray();
    // Reader may stamp a last-opened time; fall back to savedAt.
    const recency = (a: SavedArticle) => (a as SavedArticle & { openedAt?: number }).openedAt ?? a.savedAt ?? 0;
    return started.sort((a, b) => recency(b) - recency(a))[0] ?? null;
  });
  const article = $derived(reading.value ?? null);
  const articleRatio = $derived(
    article && article.paragraphs?.length ? Math.min(1, article.progress / article.paragraphs.length) : 0,
  );

  const SOURCE_NAMES: Record<string, string> = {
    miniklexikon: 'MiniKlexikon',
    klexikon: 'Klexikon',
    wikinews: 'Wikinews',
    wikipedia: 'Wikipedia',
    gutenberg: 'Project Gutenberg',
    paste: 'Your text',
  };

  /** "#/article/<source>/<encoded id without the "<source>:" prefix>". */
  function articlePath(a: Pick<SavedArticle, 'id' | 'source'>): string {
    const prefix = `${a.source}:`;
    const rest = a.id.startsWith(prefix) ? a.id.slice(prefix.length) : a.id.slice(a.id.indexOf(':') + 1);
    return `/article/${a.source}/${encodeURIComponent(rest)}`;
  }

  const counts = $derived(data.value?.counts);
  const info = $derived(data.value?.info ?? null);
  const firstLaunch = $derived(!!counts && counts.all === 0);

  const due = $derived(counts?.due ?? 0);
  const newAvailable = $derived(info ? info.fresh : (counts?.new ?? 0));
  const newToday = $derived(Math.min(newAvailable, settings.newPerSession));
  const total = $derived(due + newToday);
  const minutes = $derived(Math.max(1, Math.round((total * SECONDS_PER_WORD) / 60)));

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const gruss = hour < 5 ? 'Gute Nacht' : hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend';
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  const SHORTCUTS: { id: SmartId; label: string; icon: IconName; tone: string }[] = [
    { id: 'starred', label: 'Starred', icon: 'star', tone: 'warn' },
    { id: 'mistakes', label: 'Mistakes', icon: 'x', tone: 'bad' },
  ];

  function heroLine(): string {
    const parts: string[] = [];
    if (due) parts.push(`${due} to review`);
    if (newToday) parts.push(`${newToday} new`);
    return parts.join(' · ');
  }
</script>

<div class="page">
  <header class="top">
    <div class="titles">
      <div class="date">{today}</div>
      <h1>{greeting}</h1>
      <div class="gruss" lang="de">{gruss}!</div>
    </div>
    {#if counts && !firstLaunch}
      <button class="add-btn" aria-label="Add a word" onclick={quickAddWord}><Icon name="plus" size={24} /></button>
    {/if}
  </header>

  {#if !counts}
    <div class="card"><Skeleton lines={4} /></div>
  {:else if firstLaunch}
    <div class="welcome" in:fly|global={{ y: 12, duration: dur(260) }}>
      <p class="lead">Let’s learn some German words. How would you like to start?</p>
      <button class="choice" onclick={() => go('/levels')}>
        <span class="choice-icon tone-accent"><Icon name="sparkle" size={26} /></span>
        <span class="choice-text">
          <span class="choice-title">Start with a level</span>
          <span class="choice-sub">Ready-made word lists from A1 (beginner) to C2</span>
        </span>
        <span class="chev"><Icon name="chevron" size={18} /></span>
      </button>
      <button class="choice" onclick={() => createSet()}>
        <span class="choice-icon tone-good"><Icon name="cards" size={26} /></span>
        <span class="choice-text">
          <span class="choice-title">Create your own set</span>
          <span class="choice-sub">Add words you meet in class, books or films</span>
        </span>
        <span class="chev"><Icon name="chevron" size={18} /></span>
      </button>
      <button class="btn btn-ghost btn-block" onclick={() => go('/import')}>
        <Icon name="import" size={20} /> Import from Quizlet or a list
      </button>
    </div>
  {:else}
    <div class="stack">
      {#if total}
        <section class="hero" in:fly|global={{ y: 12, duration: dur(260) }}>
          <div class="hero-label">Today’s session</div>
          <div class="hero-count">{heroLine()}</div>
          <div class="hero-time">About {minutes} min</div>
          <button class="btn btn-lg btn-block start" onclick={() => go('/learn/smart/today')}>
            <Icon name="play" filled size={18} /> Start
          </button>
        </section>
      {:else}
        <section class="hero done" in:fly|global={{ y: 12, duration: dur(260) }}>
          <span class="done-icon"><Icon name="check" size={30} /></span>
          <div class="hero-count">All caught up</div>
          <div class="hero-time">Nothing to review right now. Nice work!</div>
          <button class="btn btn-lg btn-block start" onclick={() => go('/levels')}>
            <Icon name="sparkle" size={20} /> Learn new words
          </button>
        </section>
      {/if}

      {#if info}
        <button
          class="continue"
          onclick={() => go(`/learn/${settings.focus}`)}
          in:fly|global={{ y: 12, duration: dur(260), delay: stagger(1) }}
        >
          <ProgressRing ratio={info.progress.ratio} size={56} stroke={6}>
            <span class="pct">{Math.round(info.progress.ratio * 100)}%</span>
          </ProgressRing>
          <span class="continue-text">
            <span class="eyebrow">Continue</span>
            <span class="continue-title">{info.title}</span>
            <span class="continue-sub">{info.progress.done} / {info.progress.total} learned</span>
          </span>
          <span class="chev"><Icon name="chevron" size={18} /></span>
        </button>
      {/if}

      {#if article}
        <button
          class="continue reading"
          onclick={() => go(articlePath(article))}
          in:fly|global={{ y: 12, duration: dur(260), delay: stagger(2) }}
        >
          <span class="continue-text">
            <span class="eyebrow">Continue reading</span>
            <span class="continue-title" lang="de">{article.title}</span>
            <span class="continue-sub">{SOURCE_NAMES[article.source] ?? article.source}{article.level ? ` · ${article.level}` : ''}</span>
            <span
              class="read-bar"
              role="progressbar"
              aria-label="Reading progress"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={Math.round(articleRatio * 100)}
            >
              <span class="read-fill" style:width="{articleRatio * 100}%"></span>
            </span>
          </span>
          <span class="chev"><Icon name="chevron" size={18} /></span>
        </button>
      {/if}

      <section class="shortcuts" in:fly|global={{ y: 12, duration: dur(260), delay: stagger(3) }}>
        {#each SHORTCUTS as s}
          {@const n = counts[s.id]}
          <button class="shortcut tone-{s.tone}" disabled={!n} onclick={() => go(`/learn/smart/${s.id}`)}>
            <span class="sc-icon"><Icon name={s.icon} size={18} filled={s.id === 'starred'} /></span>
            <span class="sc-label">{s.label}</span>
            <span class="sc-count">{n}</span>
          </button>
        {/each}
        <button class="shortcut tone-accent" onclick={() => switchTab('/read')}>
          <span class="sc-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5.5A1.5 1.5 0 014.5 4H9a3 3 0 013 3v13a2 2 0 00-2-2H3zM21 5.5A1.5 1.5 0 0019.5 4H15a3 3 0 00-3 3v13a2 2 0 012-2h7z" /></svg>
          </span>
          <span class="sc-label">Read</span>
          <span class="sc-count"><Icon name="chevron" size={16} /></span>
        </button>
      </section>

      <button
        class="btn btn-block add-word"
        onclick={quickAddWord}
        in:fly|global={{ y: 12, duration: dur(260), delay: stagger(4) }}
      >
        <Icon name="plus" size={20} /> Add a word
      </button>
    </div>
  {/if}
</div>

<style>
  .top {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 0 18px;
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  .date {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  h1 {
    font-size: 30px;
    font-weight: 700;
    margin-top: 2px;
  }
  .gruss {
    color: var(--muted);
    margin-top: 2px;
  }
  .add-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    margin-top: 8px;
    border: 0;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--accent);
    cursor: pointer;
    flex-shrink: 0;
  }
  .add-btn:active {
    background: var(--surface-2);
  }

  /* ---------- Hero ---------- */
  .hero {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 20px;
    border-radius: 20px;
    background: var(--accent);
    color: var(--accent-text);
    box-shadow: var(--shadow);
  }
  .hero-label {
    font-size: 14px;
    font-weight: 600;
    opacity: 0.85;
  }
  .hero-count {
    font-size: 26px;
    font-weight: 700;
    line-height: 1.2;
  }
  .hero-time {
    opacity: 0.85;
  }
  .start {
    margin-top: 14px;
    background: var(--accent-text);
    color: var(--accent);
  }
  .hero.done {
    align-items: center;
    text-align: center;
    background: var(--surface);
    color: var(--text);
  }
  .hero.done .hero-time {
    color: var(--muted);
    opacity: 1;
  }
  .hero.done .start {
    background: var(--accent);
    color: var(--accent-text);
  }
  .done-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--good);
    color: var(--surface);
    margin-bottom: 6px;
  }

  /* ---------- Continue ---------- */
  .continue {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    padding: 14px 12px 14px 14px;
    border: 0;
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow);
    text-align: left;
    cursor: pointer;
  }
  .continue:active {
    background: var(--surface-2);
  }
  .pct {
    font-size: 13px;
    font-weight: 700;
  }
  .continue-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .eyebrow {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent);
  }
  .continue-title {
    font-size: 18px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .continue-sub {
    font-size: 14px;
    color: var(--muted);
  }
  .chev {
    display: inline-flex;
    color: var(--muted);
    flex-shrink: 0;
  }

  /* ---------- Shortcuts ---------- */
  .shortcuts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
  /* Compact tiles (three fit an iPhone width): icon + count on top, label below. */
  .shortcut {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-areas:
      'icon count'
      'label label';
    align-items: center;
    gap: 6px 8px;
    min-height: 56px;
    padding: 10px 12px;
    border: 0;
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow);
    cursor: pointer;
    text-align: left;
  }
  .shortcut:active {
    background: var(--surface-2);
  }
  .shortcut:disabled {
    cursor: default;
    opacity: 0.55;
  }
  .sc-icon {
    grid-area: icon;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--surface-2);
    flex-shrink: 0;
  }
  .tone-warn .sc-icon {
    color: var(--warn);
  }
  .tone-bad .sc-icon {
    color: var(--bad);
  }
  .tone-accent .sc-icon {
    color: var(--accent);
  }

  /* ---------- Continue reading ---------- */
  .reading {
    padding-left: 16px;
  }
  .read-bar {
    display: block;
    width: 100%;
    height: 6px;
    margin-top: 8px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--surface-2);
  }
  .read-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transition: width 0.6s var(--ease);
  }
  .sc-label {
    grid-area: label;
    min-width: 0;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sc-count {
    grid-area: count;
    justify-self: end;
    color: var(--muted);
    font-weight: 600;
  }
  .add-word {
    background: var(--surface);
    color: var(--accent);
    box-shadow: var(--shadow);
    min-height: 52px;
  }

  /* ---------- First launch ---------- */
  .welcome {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .lead {
    margin: 0 4px 4px;
    font-size: 18px;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    min-height: 88px;
    padding: 16px 12px 16px 16px;
    border: 0;
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow);
    text-align: left;
    cursor: pointer;
  }
  .choice:active {
    background: var(--surface-2);
  }
  .choice-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 52px;
    border-radius: 16px;
    background: var(--surface-2);
    flex-shrink: 0;
  }
  .tone-accent {
    color: var(--accent);
  }
  .tone-good {
    color: var(--good);
  }
  .choice-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .choice-title {
    font-size: 18px;
    font-weight: 600;
  }
  .choice-sub {
    font-size: 14px;
    color: var(--muted);
  }
</style>
