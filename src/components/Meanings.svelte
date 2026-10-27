<script lang="ts">
  import { splitMeanings } from '../lib/german/meanings';

  /**
   * A card's translation for display. One meaning shows as plain text; several meanings
   * ("последствие, результат; серия, эпизод") show as a compact numbered list.
   */
  let { translation }: { translation: string } = $props();

  const meanings = $derived(splitMeanings(translation));
</script>

{#if meanings.length > 1}
  <ol class="meanings">
    {#each meanings as m}
      <li>{m.join(', ')}</li>
    {/each}
  </ol>
{:else}
  {translation.trim()}
{/if}

<style>
  .meanings {
    margin: 0;
    padding: 0;
    list-style-position: inside;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .meanings li::marker {
    color: var(--muted);
    font-size: 0.85em;
  }
</style>
