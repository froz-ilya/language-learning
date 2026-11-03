<script lang="ts">
  import { onMount } from 'svelte';
  import { areaSub, areaTitle, stageTitle } from '../components/grammar/connectors';
  import Formula from '../components/grammar/Formula.svelte';
  import StatRing from '../components/grammar/StatRing.svelte';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { stagger } from '../components/library/actions';
  import { allExercises, areaById, stageNumber } from '../lib/grammar/content';
  import { currentStage, stageStats } from '../lib/grammar/path';
  import { loadProgress } from '../lib/grammar/store';
  import { i18n, t } from '../lib/i18n.svelte';
  import { live } from '../lib/live.svelte';
  import { dur, enter } from '../lib/motion';
  import { go, replace, route } from '../lib/router.svelte';

  // Route: #/grammar/area/<id> (constant: remounted on navigation).
  const area = areaById(route.parts[2] ?? '');

  onMount(() => {
    if (!area) replace('/grammar');
  });

  const data = live(async () => {
    if (!area) return undefined;
    const progress = await loadProgress();
    const now = Date.now();
    const all = allExercises();
    return {
      current: currentStage(area.stages, all, progress, now),
      stages: area.stages.map((stage) => ({ stage, stats: stageStats(stage, all, progress, now) })),
    };
  });

  const current = $derived(data.value?.current);
</script>

{#if area}
  <div class="page">
    <div class="head"><Header title={areaTitle(area.id)} subtitle={areaSub(area.id)} backTo="/grammar" /></div>

    <a class="card pressable cheat" href="#/grammar/cheat/{area.id}">
      <span class="badge-icon"><Icon name="search" size={20} /></span>
      <span class="text"><span class="title">{t('grammar.cheat')}</span></span>
      <span class="chev"><Icon name="chevron" size={18} /></span>
    </a>

    {#if !data.value}
      <div class="card"><Skeleton lines={4} /></div>
    {:else}
      {#each area.topics as topic, g (topic.id)}
        <section class="topic" in:enter|global={{ y: 12, duration: dur(240), delay: stagger(g, 30) }}>
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
                    <span class="n">{t('grammar.stage', { n: stageNumber(stage) })}</span>
                    {#if stage.id === current?.id}<span class="status active">{t('grammar.continue')}</span>{/if}
                    {#if stats.due}<span class="status" class:active={stage.id !== current?.id}>{t('grammar.due', { n: stats.due })}</span>{/if}
                  </span>
                  <span class="title" lang="de">{stageTitle(stage)}</span>
                </span>
                <span class="chev"><Icon name="chevron" size={18} /></span>
              </a>
            {/each}
          </div>
        </section>
      {/each}

      <div class="list all">
        <a class="list-item" href="#/grammar/area/{area.id}/practice">
          <span class="text"><span class="title">{t('grammar.practiseHere')}</span></span>
          <span class="chev"><Icon name="chevron" size={18} /></span>
        </a>
      </div>

      {#if current}
        <button class="btn btn-primary btn-lg btn-block continue" onclick={() => go(`/grammar/stage/${current.id}`)}>
          {t('grammar.continue')} · {t('grammar.stage', { n: stageNumber(current) })}
        </button>
      {/if}
    {/if}
  </div>
{/if}

<style>
  /* Area names run long in German and Russian: they wrap instead of being cut. */
  .head :global(h1) {
    font-size: 26px;
    line-height: 1.2;
    white-space: normal;
  }
  .cheat {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    color: inherit;
    text-decoration: none;
  }
  .cheat .title {
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 800;
  }
  .topic {
    margin-top: 24px;
  }
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
  /* Always in reach, as on a stage page. */
  .continue {
    position: sticky;
    bottom: calc(var(--safe-bottom) + 8px);
    z-index: 2;
    margin-top: 20px;
  }
</style>
