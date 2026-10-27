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
  /* Numbered meanings with small round counters (scale with the surrounding font size). */
  .meanings {
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: meaning;
    display: flex;
    flex-direction: column;
    gap: 0.25em;
  }
  .meanings li {
    counter-increment: meaning;
    display: flex;
    align-items: baseline;
    gap: 0.45em;
    overflow-wrap: break-word;
  }
  .meanings li::before {
    content: counter(meaning);
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    width: 1.45em;
    height: 1.45em;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
    font-family: var(--font-display);
    font-size: 0.68em;
    font-weight: 900;
    line-height: 1;
    transform: translateY(-0.12em);
  }
</style>
