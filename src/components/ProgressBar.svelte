<script lang="ts">
  import type { Progress } from '../lib/progress';

  /**
   * Thin stacked progress bar: known (light green) · learned (green) · learning (accent) · rest.
   * Grows from 0 on mount and animates every change.
   */
  let { progress }: { progress: Progress } = $props();

  let mounted = $state(false);
  $effect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => (mounted = true)));
    return () => cancelAnimationFrame(id);
  });

  const pct = (n: number) => (mounted && progress.total ? (n / progress.total) * 100 : 0);
</script>

<div
  class="bar"
  role="progressbar"
  aria-valuemin="0"
  aria-valuemax="100"
  aria-valuenow={Math.round(progress.ratio * 100)}
  aria-label="{progress.done} of {progress.total} done"
>
  <span class="seg known" style:width="{pct(progress.known)}%"></span>
  <span class="seg learned" style:width="{pct(progress.learned)}%"></span>
  <span class="seg learning" style:width="{pct(progress.learning)}%"></span>
</div>

<style>
  .bar {
    display: flex;
    width: 100%;
    height: 6px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--surface-2);
  }
  .seg {
    height: 100%;
    transition: width 0.6s var(--ease);
  }
  .known {
    background: var(--good);
    opacity: 0.45;
  }
  .learned {
    background: var(--good);
  }
  .learning {
    background: var(--accent-bar);
  }
  @media (prefers-reduced-motion: reduce) {
    .seg {
      transition: none;
    }
  }
</style>
