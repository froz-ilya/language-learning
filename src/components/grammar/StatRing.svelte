<script lang="ts">
  import Icon from '../Icon.svelte';
  import ProgressRing from '../ProgressRing.svelte';

  /** A small ring for a row of the path: the percent learned, a check once it is done. */
  let { ratio, done = false, size = 44, stroke = 5 }: { ratio: number; done?: boolean; size?: number; stroke?: number } = $props();
</script>

<span class="wrap">
  <ProgressRing ratio={done ? 1 : ratio} {size} {stroke}>
    {#if done}
      <span class="ok"><Icon name="check" size={Math.round(size * 0.45)} /></span>
    {:else}
      <span class="pct">{Math.round(ratio * 100)}%</span>
    {/if}
  </ProgressRing>
</span>

<style>
  .wrap {
    --ring-track: color-mix(in srgb, var(--tier-b) 16%, transparent);
    display: inline-flex;
    flex-shrink: 0;
  }
  .pct {
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 900;
    color: var(--tier-b);
  }
  .ok {
    display: inline-flex;
    color: var(--good);
  }
</style>
