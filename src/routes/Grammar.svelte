<script lang="ts">
  import Formula from '../components/grammar/Formula.svelte';
  import StatRing from '../components/grammar/StatRing.svelte';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { stagger } from '../components/library/actions';
  import { allExercises, GRAMMAR_STAGES, GRAMMAR_TOPICS } from '../lib/grammar/content';
  import { currentStage, stageStats, wordStats } from '../lib/grammar/path';
  import { loadProgress } from '../lib/grammar/store';
  import { i18n, t, tn } from '../lib/i18n.svelte';
  import { live } from '../lib/live.svelte';
  import { dur, enter } from '../lib/motion';
  import { go } from '../lib/router.svelte';

  /** Seconds per sentence, for the "about N min" estimate. */
  const SECONDS_PER_SENTENCE = 30;

  const data = live(async () => {
    const progress = await loadProgress();
    const now = Date.now();
    const all = allExercises();
    return {
      practised: progress.size > 0,
      due: wordStats(all, progress, now).due,
      current: currentStage(GRAMMAR_STAGES, all, progress, now),
      stages: GRAMMAR_STAGES.map((stage) => ({ stage, stats: stageStats(stage, all, progress, now) })),
    };
  });

  const due = $derived(data.value?.due ?? 0);
  const minutes = $derived(Math.max(1, Math.round((due * SECONDS_PER_SENTENCE) / 60)));
  const current = $derived(data.value?.current);
</script>

<div class="page">
  <Header title={t('grammar.title')} />

  <a class="card pressable cheat" href="#/grammar/cheat">
    <span class="badge-icon"><Icon name="search" size={20} /></span>
    <span class="text">
      <span class="title">{t('grammar.cheat')}</span>
      <span class="sub">{t('grammar.cheatSub')}</span>
    </span>
    <span class="chev"><Icon name="chevron" size={18} /></span>
  </a>

  {#if !data.value}
    <div class="card"><Skeleton lines={4} /></div>
  {:else}
    {#if !data.value.practised}
      <section class="hero" in:enter|global={{ y: 12, duration: dur(260) }}>
        <div class="hero-count">{t('grammar.firstTitle')}</div>
        <button class="btn btn-lg btn-block start" onclick={() => go(`/grammar/stage/${(current ?? GRAMMAR_STAGES[0]).id}`)}>{t('common.start')}</button>
      </section>
    {:else if due}
      <section class="hero" in:enter|global={{ y: 12, duration: dur(260) }}>
        <div class="hero-top">
          <span class="hero-label">{t('grammar.review')}</span>
          <span class="hero-time">≈ {tn('common.minutes', minutes)}</span>
        </div>
        <div class="num">{due}</div>
        <button class="btn btn-lg btn-block start" onclick={() => go('/grammar/review/practice')}>
          <Icon name="play" filled size={18} /> {t('common.start')}
        </button>
      </section>
    {:else}
      <section class="hero done" in:enter|global={{ y: 12, duration: dur(260) }}>
        <span class="done-icon"><Icon name="check" size={30} /></span>
        <div class="hero-count">{t('grammar.allDone')}</div>
        {#if current}
          <button class="btn btn-lg btn-block start" onclick={() => go(`/grammar/stage/${current.id}`)}>{t('grammar.continue')}</button>
        {:else}
          <button class="btn btn-lg btn-block start" onclick={() => go('/grammar/anyway/practice')}>{t('grammar.anyway')}</button>
        {/if}
      </section>
    {/if}

    {#each GRAMMAR_TOPICS as topic, g (topic.id)}
      <section class="section" in:enter|global={{ y: 12, duration: dur(240), delay: stagger(g, 30) }}>
        <h2 class="group">
          <a href="#/grammar/{topic.id}">
            <span class="group-title">{topic.title[i18n.lang]}</span>
            <span class="chev"><Icon name="chevron" size={18} /></span>
          </a>
        </h2>
        <div class="formula"><Formula text={topic.formula[i18n.lang]} /></div>
        <div class="stages">
          {#each data.value.stages.filter(({ stage }) => stage.topic === topic.id) as { stage, stats } (stage.id)}
            <a class="stage" href="#/grammar/stage/{stage.id}">
              <StatRing ratio={stats.ratio} done={stats.done} />
              <span class="text">
                <span class="line">
                  <span class="n">{t('grammar.stage', { n: stage.id })}</span>
                  {#if stage.id === current?.id}<span class="status active">{t('grammar.continue')}</span>{/if}
                  {#if stats.due}<span class="status" class:active={stage.id !== current?.id}>{t('grammar.due', { n: stats.due })}</span>{/if}
                </span>
                <span class="title" lang="de">{stage.words.join(' · ')}</span>
              </span>
              <span class="chev"><Icon name="chevron" size={18} /></span>
            </a>
          {/each}
        </div>
      </section>
    {/each}

    <div class="list all">
      <a class="list-item" href="#/grammar/all/practice">
        <span class="text"><span class="title">{t('grammar.practiseAll')}</span></span>
        <span class="chev"><Icon name="chevron" size={18} /></span>
      </a>
    </div>
  {/if}
</div>

<style>
  /* ---------- Hero (as on Today) ---------- */
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
  .num {
    margin: 6px 0 2px;
    font-family: var(--font-display);
    font-size: 48px;
    font-weight: 900;
    line-height: 1;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }
  .start {
    margin-top: 14px;
    background: var(--accent-fill);
    color: var(--accent-text);
    box-shadow: var(--shadow-accent);
  }
  .hero-count {
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 900;
    line-height: 1.2;
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

  /* ---------- Cheat sheet: reachable at once, in every state ---------- */
  .cheat {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
    padding: 10px 12px;
    color: inherit;
    text-decoration: none;
  }
  .cheat .title {
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 800;
  }
  .cheat .sub {
    font-size: 14px;
    color: var(--muted);
  }

  /* ---------- Word-order groups: the rule, then its stages (the rows of Levels, tighter) ---------- */
  .group {
    margin: 0 4px;
    font-size: 19px;
    line-height: 1.25;
  }
  .group a {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 44px;
    color: inherit;
    text-decoration: none;
  }
  .group-title {
    min-width: 0;
  }
  .formula {
    margin: 0 4px 12px;
  }
  .all {
    margin-top: 28px;
  }
  .stages {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .stage {
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 66px;
    padding: 10px 12px;
    border-radius: var(--radius);
    background:
      radial-gradient(90px 70px at 34px 50%, color-mix(in srgb, var(--tier-b) 12%, transparent), transparent 100%),
      var(--surface);
    box-shadow: var(--shadow);
    color: inherit;
    text-decoration: none;
    transition:
      transform var(--dur-fast) var(--ease),
      background-color var(--dur-fast) var(--ease);
  }
  .stage:active {
    transform: scale(0.98);
    background-color: var(--surface-2);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 6px;
  }
  .n {
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
  }
  .stage .title {
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 800;
    line-height: 1.25;
  }
  .status {
    display: inline-flex;
    align-items: center;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 12.5px;
    font-weight: 700;
    color: var(--muted);
  }
  .status.active {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .chev {
    display: inline-flex;
    color: var(--faint);
  }
</style>
