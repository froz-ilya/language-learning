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
    padding: 28px 20px 24px;
    background: var(--surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--accent);
    margin-bottom: 4px;
  }
  h2 {
    font-size: 20px;
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
