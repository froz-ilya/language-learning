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
        class="level tier-{code[0].toLowerCase()}"
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
    margin: -4px 4px 18px;
  }
  .grid {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  /* CEFR tiers get their own quiet hue (A aqua, B periwinkle, C lilac); progress stays saffron. */
  .tier-a {
    --tier: var(--tier-a);
  }
  .tier-b {
    --tier: var(--tier-b);
  }
  .tier-c {
    --tier: var(--tier-c);
  }
  .level {
    --ring-track: color-mix(in srgb, var(--tier) 16%, transparent);
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 88px;
    padding: 14px 12px 14px 14px;
    border-radius: var(--radius);
    background:
      radial-gradient(120px 90px at 44px 50%, color-mix(in srgb, var(--tier) 12%, transparent), transparent 100%),
      var(--surface);
    box-shadow: var(--shadow);
    color: inherit;
    text-decoration: none;
    transition:
      transform var(--dur-fast) var(--ease),
      background-color var(--dur-fast) var(--ease);
  }
  .level:active {
    transform: scale(0.98);
    background-color: var(--surface-2);
  }
  .code {
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 900;
    letter-spacing: -0.01em;
    color: var(--tier);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .title {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
  }
  .sub {
    font-size: 14px;
    color: var(--muted);
  }
  .status {
    display: inline-flex;
    align-self: flex-start;
    align-items: center;
    gap: 4px;
    margin-top: 6px;
    padding: 2px 9px;
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
  .note {
    margin: 18px 8px 0;
    text-align: center;
  }
</style>
