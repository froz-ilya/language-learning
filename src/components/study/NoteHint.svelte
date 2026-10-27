<script lang="ts">
  import Icon from '../Icon.svelte';

  /** The card's own note (memory hook), shown while studying. Renders nothing without a note. */
  let { notes }: { notes: string } = $props();
</script>

{#if notes.trim()}
  <div class="note-hint">
    <span class="icon"><Icon name="sparkle" size={16} /></span>
    <span>{notes.trim()}</span>
  </div>
{/if}

<style>
  .note-hint {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    margin-top: 10px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--warn) 12%, transparent);
    font-size: 15px;
    text-align: left;
    white-space: pre-line;
  }
  .icon {
    color: var(--warn);
    flex-shrink: 0;
    margin-top: 1px;
  }
</style>
