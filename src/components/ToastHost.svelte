<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { ui, dismissToast, type Toast } from '../lib/ui/dialogs.svelte';
  import { dur } from '../lib/motion';

  /** Stacked toasts above the tab bar. Mounted once in App. */
  function act(t: Toast) {
    t.onAction?.();
    dismissToast(t.id);
  }
</script>

<div class="toasts" aria-live="polite" aria-atomic="false">
  {#each ui.toasts as t (t.id)}
    <div
      class="toast"
      role="status"
      animate:flip={{ duration: dur(220), easing: cubicOut }}
      in:fly={{ y: 24, duration: dur(260), easing: cubicOut }}
      out:fade={{ duration: dur(160) }}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <span class="msg" onclick={() => dismissToast(t.id)}>{t.message}</span>
      {#if t.actionLabel}
        <button class="action" onclick={() => act(t)}>{t.actionLabel}</button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(max(var(--safe-bottom), var(--tabbar-h)) + 12px);
    z-index: 90;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    width: 100%;
    max-width: 480px;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 6px 6px 6px 16px;
    border-radius: 16px;
    background: var(--toast-bg);
    color: var(--toast-text);
    box-shadow: var(--shadow-lg);
    font-size: 15px;
    font-weight: 500;
  }
  .msg {
    flex: 1;
    min-width: 0;
    padding: 6px 0;
  }
  .action {
    flex-shrink: 0;
    min-height: 36px;
    padding: 6px 12px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--toast-action);
    font-family: var(--font-display);
    font-weight: 800;
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease),
      transform var(--dur-fast) var(--ease);
  }
  .action:active {
    background: var(--accent-soft);
    transform: scale(0.96);
  }
  @media (prefers-reduced-motion: reduce) {
    .action:active {
      transform: none;
    }
  }
</style>
