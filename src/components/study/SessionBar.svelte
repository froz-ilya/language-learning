<script lang="ts">
  import Icon from '../Icon.svelte';

  /** Session top bar: close (X), title, count and a thin progress bar that eases forward. */
  let {
    title = '',
    count = '',
    ratio = null,
    onclose,
  }: {
    title?: string;
    count?: string;
    /** 0…1, or null to hide the bar. */
    ratio?: number | null;
    onclose: () => void;
  } = $props();

  const pct = $derived(ratio == null ? 0 : Math.round(Math.max(0, Math.min(1, ratio)) * 1000) / 10);
</script>

<div class="session-bar">
  <div class="top">
    <button class="icon-btn" aria-label="Close" onclick={onclose}><Icon name="x" /></button>
    <div class="titles">
      {#if title}<div class="title">{title}</div>{/if}
      {#if count}<div class="muted small count">{count}</div>{/if}
    </div>
    <div class="spacer-40"></div>
  </div>
  {#if ratio != null}
    <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div class="bar" style:transform="scaleX({pct / 100})"></div>
    </div>
  {/if}
</div>

<style>
  .session-bar {
    margin-bottom: 16px;
  }
  .top {
    display: flex;
    align-items: center;
    min-height: 48px;
    margin: 0 -8px;
  }
  .titles {
    flex: 1;
    text-align: center;
    min-width: 0;
  }
  .title {
    font-family: var(--font-display);
    font-weight: 800;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .count {
    font-variant-numeric: tabular-nums;
  }
  .spacer-40 {
    width: 40px;
    flex-shrink: 0;
  }
  .progress {
    height: 6px;
    border-radius: 999px;
    background: var(--surface-2);
    overflow: hidden;
    margin-top: 4px;
  }
  .bar {
    height: 100%;
    width: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, color-mix(in srgb, var(--accent-bar) 70%, var(--warn)), var(--accent-bar));
    box-shadow: 0 0 12px var(--accent-glow);
    transform-origin: left center;
    transition: transform 0.45s var(--ease, cubic-bezier(0.2, 0.8, 0.2, 1));
  }
  @media (prefers-reduced-motion: reduce) {
    .bar {
      transition: none;
    }
  }
</style>
