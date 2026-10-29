<script lang="ts">
  import { fly, slide } from 'svelte/transition';
  import Icon, { type IconName } from '../components/Icon.svelte';
  import ProgressRing from '../components/ProgressRing.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { createSet, focusInfo, quickAddWord, stagger } from '../components/library/actions';
  import { go, switchTab } from '../lib/router.svelte';
  import { primeKeyboard } from '../lib/ui/keyboard';
  import { db } from '../lib/db/schema';
  import type { SavedArticle } from '../lib/reading/types';
  import { live } from '../lib/live.svelte';
  import { dur } from '../lib/motion';
  import { settings } from '../lib/settings.svelte';
  import { smartCounts, type SmartId } from '../lib/study/sources';
  import {
    dismissInstallBanner,
    install,
    installBannerDismissed,
    promptInstall,
    showIOSInstallHint,
  } from '../lib/install.svelte';

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

  // "Install Deutsch for offline use" (Android/desktop Chrome: Install button; iOS Safari: hint).
  const iosInstallHint = showIOSInstallHint();
  let bannerDismissed = $state(installBannerDismissed());
  const showInstallBanner = $derived(!bannerDismissed && (install.canInstall || iosInstallHint));

  function dismissBanner() {
    bannerDismissed = true;
    dismissInstallBanner();
  }

  async function installNow() {
    const outcome = await promptInstall();
    if (outcome !== 'unavailable') dismissBanner();
  }

  function heroLine(): string {
    const parts: string[] = [];
    if (due) parts.push(`${due} to review`);
    if (newToday) parts.push(`${newToday} new`);
    return parts.join(' · ');
  }

  /** Search, with the keyboard already up (see lib/ui/keyboard). */
  function openSearch() {
    primeKeyboard();
    go('/search');
  }
</script>

<div class="page">
  <header class="top">
    <div class="titles">
      <div class="date">{today} <span class="beta-tag" title="Some things may not work yet">Beta</span></div>
      <h1>{greeting}</h1>
      <div class="gruss" lang="de">{gruss}!</div>
    </div>
    <div class="top-actions" class:two={counts && !firstLaunch}>
      <button class="add-btn" aria-label="Search for a word" onclick={openSearch}><Icon name="search" size={22} /></button>
      {#if counts && !firstLaunch}
        <button class="add-btn" aria-label="Add a word" onclick={quickAddWord}><Icon name="plus" size={24} /></button>
      {/if}
    </div>
  </header>

  {#if showInstallBanner}
    <div class="card install-banner" transition:slide={{ duration: dur(220) }}>
      <span class="ib-icon"><Icon name="import" size={20} /></span>
      <div class="ib-text">
        <div class="ib-title">Install Deutsch for offline use</div>
        {#if !install.canInstall}<div class="small muted">Share → Add to Home Screen</div>{/if}
      </div>
      {#if install.canInstall}
        <button class="btn btn-primary ib-btn" onclick={installNow}>Install</button>
      {/if}
      <button class="icon-btn ib-close" aria-label="Dismiss" onclick={dismissBanner}><Icon name="x" size={18} /></button>
    </div>
  {/if}

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
          <div class="hero-top">
            <span class="hero-label">Today’s session</span>
            <span class="hero-time">≈ {minutes} min</span>
          </div>
          <div class="hero-stats" role="group" aria-label={heroLine()}>
            {#if due}
              <span class="stat"><span class="num">{due}</span><span class="lbl">to review</span></span>
            {/if}
            {#if newToday}
              <span class="stat fresh"><span class="num">{newToday}</span><span class="lbl">new</span></span>
            {/if}
          </div>
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

      {#if counts.hard}
        <button
          class="continue hard"
          onclick={() => go('/hard')}
          in:fly|global={{ y: 12, duration: dur(260), delay: stagger(3) }}
        >
          <span class="hard-icon"><Icon name="flame" size={26} filled /></span>
          <span class="continue-text">
            <span class="eyebrow">Hard words</span>
            <span class="continue-title">{counts.hard} {counts.hard === 1 ? 'word needs' : 'words need'} extra help</span>
            <span class="continue-sub">Practice them or add a memory hook</span>
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
  .install-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
    padding: 12px 8px 12px 14px;
  }
  .ib-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 12px;
    flex-shrink: 0;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .ib-text {
    flex: 1;
    min-width: 0;
  }
  .ib-title {
    font-weight: 600;
    line-height: 1.3;
  }
  .ib-btn {
    min-height: 38px;
    padding: 6px 14px;
    font-size: 15px;
  }
  .ib-close {
    color: var(--muted);
  }
  .top {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 0 20px;
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  .date {
    font-family: var(--font-display);
    font-size: 12.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--muted);
  }
  h1 {
    font-size: 32px;
    font-weight: 900;
    margin-top: 4px;
  }
  .gruss {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 700;
    color: var(--accent);
    margin-top: 2px;
  }
  .top-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  /* Search + add side by side: a little smaller, so the date line keeps its width. */
  .top-actions.two .add-btn {
    width: 42px;
    height: 42px;
    border-radius: 14px;
  }
  .add-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    height: 46px;
    margin-top: 10px;
    border: 0;
    border-radius: 16px;
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--accent);
    cursor: pointer;
    flex-shrink: 0;
    transition: transform var(--dur-fast) var(--ease);
  }
  .add-btn:active {
    background: var(--surface-2);
    transform: scale(0.94);
  }

  /* ---------- Hero ---------- */
  .hero {
    position: relative;
    overflow: hidden;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 20px 20px 18px;
    border-radius: var(--radius-lg);
    background: var(--grad-feature);
    box-shadow: var(--shadow-feature);
  }
  /* A warm saffron sun rising behind the numbers */
  .hero::before {
    content: '';
    position: absolute;
    z-index: -1;
    top: -90px;
    right: -70px;
    width: 240px;
    height: 240px;
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--accent-fill) 28%, transparent), color-mix(in srgb, var(--accent-fill) 0%, transparent) 68%);
  }
  .hero::after {
    content: '';
    position: absolute;
    z-index: -1;
    top: -38px;
    right: -38px;
    width: 140px;
    height: 140px;
    border-radius: 50%;
    border: 1.5px solid color-mix(in srgb, var(--accent-fill) 22%, transparent);
    box-shadow:
      0 0 0 22px color-mix(in srgb, var(--accent-fill) 3.5%, transparent),
      0 0 0 46px color-mix(in srgb, var(--accent-fill) 2.5%, transparent);
  }
  .hero-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .hero-label {
    font-family: var(--font-display);
    font-size: 12.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--accent);
  }
  .hero-time {
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--hairline);
    color: var(--muted);
    font-size: 13px;
    font-weight: 600;
  }
  .hero-stats {
    display: flex;
    gap: 28px;
    margin: 6px 0 2px;
  }
  .stat {
    display: flex;
    flex-direction: column;
  }
  .num {
    font-family: var(--font-display);
    font-size: 48px;
    font-weight: 900;
    line-height: 1;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }
  .stat.fresh .num {
    color: var(--accent);
  }
  .lbl {
    margin-top: 4px;
    font-size: 14px;
    font-weight: 600;
    color: var(--muted);
  }
  .start {
    margin-top: 14px;
    background: var(--accent-fill);
    color: var(--accent-text);
    box-shadow: var(--shadow-accent);
  }
  .hero.done {
    align-items: center;
    text-align: center;
    gap: 4px;
    padding-top: 24px;
  }
  .hero.done::after {
    display: none;
  }
  .hero.done::before {
    right: auto;
    left: 50%;
    transform: translateX(-50%);
    top: -120px;
    background: radial-gradient(circle, color-mix(in srgb, var(--good) 22%, transparent), color-mix(in srgb, var(--good) 0%, transparent) 68%);
  }
  .hero-count {
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 900;
    line-height: 1.2;
  }
  .hero.done .hero-time {
    padding: 0;
    background: none;
    font-size: 15px;
    font-weight: 400;
  }
  .done-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 60px;
    height: 60px;
    border-radius: 20px;
    background: color-mix(in srgb, var(--good) 18%, transparent);
    color: var(--good);
    margin-bottom: 8px;
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
    transition:
      transform var(--dur-fast) var(--ease),
      background-color var(--dur-fast) var(--ease);
  }
  .continue:active {
    background: var(--surface-2);
    transform: scale(0.98);
  }
  .hard-icon {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    flex-shrink: 0;
    border-radius: 18px;
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 15%, transparent);
  }
  .hard .eyebrow {
    color: var(--warn);
  }
  .pct {
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 900;
  }
  .continue-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .eyebrow {
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
  }
  .continue-title {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
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
    color: var(--faint);
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
    gap: 10px 8px;
    min-height: 56px;
    padding: 12px;
    border: 0;
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow);
    cursor: pointer;
    text-align: left;
    transition:
      transform var(--dur-fast) var(--ease),
      background-color var(--dur-fast) var(--ease);
  }
  .shortcut:active {
    background: var(--surface-2);
    transform: scale(0.96);
  }
  .shortcut:disabled {
    cursor: default;
    opacity: 0.5;
    transform: none;
  }
  .sc-icon {
    grid-area: icon;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 11px;
    color: var(--tone);
    background: color-mix(in srgb, var(--tone) 15%, transparent);
    flex-shrink: 0;
  }
  .tone-warn {
    --tone: var(--accent);
  }
  .tone-bad {
    --tone: var(--bad);
  }
  .tone-accent {
    --tone: var(--der);
  }
  .tone-good {
    --tone: var(--good);
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
    background: var(--accent-bar);
    transition: width 0.6s var(--ease);
  }
  .sc-label {
    grid-area: label;
    min-width: 0;
    font-family: var(--font-display);
    font-weight: 800;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sc-count {
    grid-area: count;
    justify-self: end;
    align-self: start;
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 900;
    line-height: 1;
    color: var(--text);
  }
  .shortcut:disabled .sc-count {
    color: var(--muted);
  }
  .tone-accent .sc-count {
    color: var(--faint);
    align-self: center;
  }
  .add-word {
    background: transparent;
    color: var(--accent);
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 35%, transparent);
    min-height: 52px;
    border-radius: var(--radius);
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
    color: var(--muted);
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    min-height: 92px;
    padding: 16px 12px 16px 16px;
    border: 0;
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow);
    text-align: left;
    cursor: pointer;
    transition:
      transform var(--dur-fast) var(--ease),
      background-color var(--dur-fast) var(--ease);
  }
  .choice:active {
    background: var(--surface-2);
    transform: scale(0.98);
  }
  .choice-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 54px;
    height: 54px;
    border-radius: 18px;
    color: var(--tone);
    background: color-mix(in srgb, var(--tone) 15%, transparent);
    flex-shrink: 0;
  }
  .choice-icon.tone-accent {
    --tone: var(--accent);
  }
  .choice-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .choice-title {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
  }
  .choice-sub {
    font-size: 14px;
    color: var(--muted);
  }
</style>
