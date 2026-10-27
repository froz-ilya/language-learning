<script lang="ts">
  import Icon, { type IconName } from '../Icon.svelte';
  import ProgressBar from '../ProgressBar.svelte';
  import SwipeRow, { type SwipeAction } from '../SwipeRow.svelte';
  import type { Progress } from '../../lib/progress';
  import { learnedLine } from './actions';

  /**
   * A tappable card for a set / folder / topic: icon, name, "x / n learned" and a progress
   * bar. Optional swipe actions (left = revealed by swiping left, e.g. Delete).
   */
  let {
    href,
    title,
    icon = 'cards',
    tone = 'accent',
    sub = '',
    progress,
    left,
    right,
  }: {
    href: string;
    title: string;
    icon?: IconName;
    tone?: 'accent' | 'warn' | 'good';
    /** Extra text shown before the learned count, e.g. "3 sets". */
    sub?: string;
    progress?: Progress;
    left?: SwipeAction;
    right?: SwipeAction;
  } = $props();

  const line = $derived([sub, learnedLine(progress)].filter(Boolean).join(' · '));
</script>

{#snippet body()}
  <a class="prow" {href}>
    <span class="ico tone-{tone}"><Icon name={icon} size={20} /></span>
    <span class="text">
      <span class="name">{title}</span>
      {#if line}<span class="line">{line}</span>{/if}
      {#if progress && progress.total}
        <span class="bar"><ProgressBar {progress} /></span>
      {/if}
    </span>
    <span class="chev"><Icon name="chevron" size={18} /></span>
  </a>
{/snippet}

<div class="pcard">
  {#if left || right}
    <SwipeRow {left} {right}>{@render body()}</SwipeRow>
  {:else}
    {@render body()}
  {/if}
</div>

<style>
  .pcard {
    border-radius: var(--radius);
    overflow: hidden;
    box-shadow: var(--shadow);
    background: var(--surface);
  }
  .prow {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 68px;
    padding: 12px 12px 12px 14px;
    background: var(--surface);
    color: inherit;
    text-decoration: none;
  }
  .prow:active {
    background: var(--surface-2);
  }
  .ico {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: var(--surface-2);
    flex-shrink: 0;
  }
  .tone-accent {
    color: var(--accent);
  }
  .tone-warn {
    color: var(--warn);
  }
  .tone-good {
    color: var(--good);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .line {
    font-size: 14px;
    color: var(--muted);
  }
  .bar {
    display: block;
    margin-top: 6px;
  }
  .chev {
    color: var(--muted);
    display: inline-flex;
    flex-shrink: 0;
  }
</style>
