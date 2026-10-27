<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * Circular progress. Animates from 0 to `ratio` on mount and on every change.
   *
   *   <ProgressRing ratio={p.ratio}>{Math.round(p.ratio * 100)}%</ProgressRing>
   *
   * `color` defaults to accent, or green once complete.
   */
  let {
    ratio,
    size = 56,
    stroke = 6,
    color,
    children,
  }: { ratio: number; size?: number; stroke?: number; color?: string; children?: Snippet } = $props();

  const r = $derived((size - stroke) / 2);
  const circumference = $derived(2 * Math.PI * r);
  const clamped = $derived(Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0)));

  let mounted = $state(false);
  $effect(() => {
    // Two frames so the initial (empty) state is painted before transitioning.
    const id = requestAnimationFrame(() => requestAnimationFrame(() => (mounted = true)));
    return () => cancelAnimationFrame(id);
  });

  const offset = $derived(circumference * (1 - (mounted ? clamped : 0)));
  const tone = $derived(color ?? (clamped >= 1 ? 'var(--good)' : 'var(--accent)'));
</script>

<div
  class="ring"
  style:width="{size}px"
  style:height="{size}px"
  role="progressbar"
  aria-valuemin="0"
  aria-valuemax="100"
  aria-valuenow={Math.round(clamped * 100)}
>
  <svg width={size} height={size} viewBox="0 0 {size} {size}" aria-hidden="true">
    <circle class="track" cx={size / 2} cy={size / 2} {r} stroke-width={stroke} />
    <circle
      class="value"
      cx={size / 2}
      cy={size / 2}
      {r}
      stroke-width={stroke}
      stroke={tone}
      stroke-dasharray={circumference}
      stroke-dashoffset={offset}
      opacity={clamped > 0 ? 1 : 0}
    />
  </svg>
  {#if children}<div class="inner">{@render children()}</div>{/if}
</div>

<style>
  .ring {
    position: relative;
    display: inline-grid;
    place-items: center;
    flex-shrink: 0;
  }
  svg {
    position: absolute;
    inset: 0;
    transform: rotate(-90deg);
  }
  circle {
    fill: none;
  }
  .track {
    stroke: var(--surface-2);
  }
  .value {
    stroke-linecap: round;
    transition:
      stroke-dashoffset 0.8s var(--ease),
      stroke 0.3s var(--ease);
  }
  .inner {
    position: relative;
    font-size: 13px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    text-align: center;
  }
  @media (prefers-reduced-motion: reduce) {
    .value {
      transition: none;
    }
  }
</style>
