<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade } from 'svelte/transition';
  import Icon, { type IconName } from '../Icon.svelte';
  import { dur } from '../../lib/motion';

  /** Friendly empty state: a big icon, a title, one line of help and an action or two. */
  let {
    icon,
    title,
    text = '',
    children,
  }: { icon: IconName; title: string; text?: string; children?: Snippet } = $props();
</script>

<div class="empty-state" in:fade|global={{ duration: dur(200) }}>
  <span class="badge"><Icon name={icon} size={30} /></span>
  <h2>{title}</h2>
  {#if text}<p>{text}</p>{/if}
  {#if children}<div class="actions">{@render children()}</div>{/if}
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 8px;
    padding: 32px 20px 22px;
    position: relative;
    overflow: hidden;
    isolation: isolate;
    background: var(--surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
  }
  /* Soft saffron halo behind the badge */
  .empty-state::before {
    content: '';
    position: absolute;
    z-index: -1;
    top: -80px;
    left: 50%;
    width: 240px;
    height: 220px;
    transform: translateX(-50%);
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--accent-fill) 14%, transparent), color-mix(in srgb, var(--accent-fill) 0%, transparent) 68%);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 72px;
    height: 72px;
    border-radius: 24px;
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-fill) 18%, transparent);
    color: var(--accent);
    margin-bottom: 6px;
    transform: rotate(-6deg);
  }
  h2 {
    font-size: 21px;
  }
  p {
    margin: 0;
    color: var(--muted);
    max-width: 30ch;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    margin-top: 10px;
  }
</style>
