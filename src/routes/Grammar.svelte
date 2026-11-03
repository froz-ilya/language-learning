<script lang="ts">
  import { areaSub, areaTitle, stageTitle } from '../components/grammar/connectors';
  import StatRing from '../components/grammar/StatRing.svelte';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { stagger } from '../components/library/actions';
  import { allExercises, areaExercises, GRAMMAR_AREAS, stageNumber } from '../lib/grammar/content';
  import { currentStage, wordStats } from '../lib/grammar/path';
  import { loadProgress } from '../lib/grammar/store';
  import { t, tn } from '../lib/i18n.svelte';
  import { live } from '../lib/live.svelte';
  import { dur, enter } from '../lib/motion';
  import { go } from '../lib/router.svelte';

  /** Seconds per sentence, for the "about N min" estimate. */
  const SECONDS_PER_SENTENCE = 30;

  const data = live(async () => {
    const progress = await loadProgress();
    const now = Date.now();
    const all = allExercises();
    const areas = GRAMMAR_AREAS.map((area) => {
      const exercises = areaExercises(area);
      const current = currentStage(area.stages, all, progress, now);
      const lastAt = Math.max(0, ...exercises.map((ex) => progress.get(ex.id)?.lastAt ?? 0));
      return { area, current, lastAt, stats: wordStats(exercises, progress, now) };
    });
    // Nothing due: carry on where the user last practised, else in any area that isn't finished.
    const open = areas.filter((a) => a.current);
    const next = open.length ? open.reduce((a, b) => (b.lastAt > a.lastAt ? b : a)) : undefined;
    return {
      practised: progress.size > 0,
      due: wordStats(all, progress, now).due,
      areas,
      next: next && { area: next.area, stage: next.current! },
    };
  });

  const due = $derived(data.value?.due ?? 0);
  const minutes = $derived(Math.max(1, Math.round((due * SECONDS_PER_SENTENCE) / 60)));
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
    {#if due}
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
    {:else if data.value.practised && data.value.next}
      {@const next = data.value.next}
      <!-- Nothing due is not "done": the next step is the stage the user is on. -->
      <section class="hero" in:enter|global={{ y: 12, duration: dur(260) }}>
        <div class="hero-top">
          <span class="hero-label">{areaTitle(next.area.id)}</span>
          <span class="hero-time">{t('grammar.stageOf', { n: stageNumber(next.stage), total: next.area.stages.length })}</span>
        </div>
        <div class="hero-count" lang="de">{stageTitle(next.stage)}</div>
        <button class="btn btn-lg btn-block start" onclick={() => go(`/grammar/stage/${next.stage.id}`)}>
          <Icon name="play" filled size={18} /> {t('grammar.continue')}
        </button>
      </section>
    {:else if data.value.practised}
      <section class="hero done" in:enter|global={{ y: 12, duration: dur(260) }}>
        <span class="done-icon"><Icon name="check" size={30} /></span>
        <div class="hero-count">{t('grammar.allDone')}</div>
        <button class="btn btn-lg btn-block start" onclick={() => go('/grammar/anyway/practice')}>{t('grammar.anyway')}</button>
      </section>
    {/if}

    <div class="areas">
      {#each data.value.areas as { area, current, stats }, a (area.id)}
        <a class="area" href="#/grammar/area/{area.id}" in:enter|global={{ y: 12, duration: dur(240), delay: stagger(a + 1, 30) }}>
          <StatRing ratio={stats.ratio} done={!current} size={48} />
          <span class="text">
            <span class="title">{areaTitle(area.id)}</span>
            <span class="sub">{areaSub(area.id)}</span>
            <span class="line">
              {#if current}<span class="n">{t('grammar.stageOf', { n: stageNumber(current), total: area.stages.length })}</span>{/if}
              {#if stats.due}<span class="status">{t('grammar.due', { n: stats.due })}</span>{/if}
            </span>
          </span>
          <span class="chev"><Icon name="chevron" size={18} /></span>
        </a>
      {/each}
    </div>

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
    flex-shrink: 0;
    white-space: nowrap;
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

  /* ---------- Areas: one card each, their path is a page of its own ---------- */
  .areas {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 22px;
  }
  .area {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 88px;
    padding: 14px;
    border-radius: var(--radius-lg);
    background:
      radial-gradient(110px 90px at 40px 50%, color-mix(in srgb, var(--tier-b) 12%, transparent), transparent 100%),
      var(--surface);
    box-shadow: var(--shadow);
    color: inherit;
    text-decoration: none;
    transition:
      transform var(--dur-fast) var(--ease),
      background-color var(--dur-fast) var(--ease);
  }
  .area:active {
    transform: scale(0.98);
    background-color: var(--surface-2);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .area .title {
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 800;
    line-height: 1.25;
  }
  .area .sub {
    font-size: 14px;
    color: var(--muted);
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 6px;
    margin-top: 4px;
  }
  .n {
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
  }
  .status {
    display: inline-flex;
    align-items: center;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--accent-soft);
    font-size: 12.5px;
    font-weight: 700;
    color: var(--accent);
  }
  .all {
    margin-top: 28px;
  }
  .chev {
    display: inline-flex;
    color: var(--faint);
  }
</style>
