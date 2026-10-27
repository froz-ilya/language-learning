<script lang="ts">
  import { fly } from 'svelte/transition';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import ProgressRing from '../components/ProgressRing.svelte';
  import { levelIndex, levelProgress, stagger } from '../components/library/actions';
  import { live } from '../lib/live.svelte';
  import { dur } from '../lib/motion';
  import { LEVEL_TITLES, LEVELS, type LevelIndex } from '../lib/levels/types';

  let index = $state<LevelIndex | null>(null);
  levelIndex().then((i) => (index = i));

  const installed = live(async () => {
    const list = await Promise.all(LEVELS.map(async (code) => [code, await levelProgress(code)] as const));
    return new Map(list);
  });

  function wordCount(code: string): number | undefined {
    return index?.levels.find((l) => l.code === code)?.words;
  }
</script>

<div class="page">
  <Header title="Levels" />

  <p class="intro muted">Ready-made word lists, from your first words to near-native vocabulary.</p>

  <div class="grid">
    {#each LEVELS as code, i (code)}
      {@const p = installed.value?.get(code)}
      {@const words = p?.total ?? wordCount(code)}
      <a
        class="level"
        class:started={!!p}
        href="#/level/{code}"
        in:fly|global={{ y: 12, duration: dur(240), delay: stagger(i, 40) }}
      >
        <ProgressRing ratio={p?.ratio ?? 0} size={60} stroke={6}>
          <span class="code">{code}</span>
        </ProgressRing>
        <span class="text">
          <span class="title">{LEVEL_TITLES[code]}</span>
          <span class="sub">
            {#if words !== undefined}{words.toLocaleString('en')} words{:else}&nbsp;{/if}
          </span>
          <span class="status" class:active={!!p}>
            {#if !p}
              Not started
            {:else if p.ratio >= 1}
              <Icon name="check" size={14} /> Complete
            {:else}
              {Math.round(p.ratio * 100)}% learned
            {/if}
          </span>
        </span>
        <span class="chev"><Icon name="chevron" size={18} /></span>
      </a>
    {/each}
  </div>

  <p class="note small muted">Levels are approximate, based on word frequency.</p>
</div>

<style>
  .intro {
    margin: -4px 4px 16px;
  }
  .grid {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .level {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 84px;
    padding: 12px 12px 12px 14px;
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow);
    color: inherit;
    text-decoration: none;
  }
  .level:active {
    background: var(--surface-2);
  }
  .code {
    font-size: 17px;
    font-weight: 800;
    color: var(--muted);
  }
  .started .code {
    color: var(--accent);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .title {
    font-size: 18px;
    font-weight: 600;
  }
  .sub {
    font-size: 14px;
    color: var(--muted);
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-top: 2px;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
  }
  .status.active {
    color: var(--good);
  }
  .chev {
    display: inline-flex;
    color: var(--muted);
  }
  .note {
    margin: 16px 8px 0;
    text-align: center;
  }
</style>
