<script lang="ts">
  import { parsePrepEntry, prepOfCard } from '../../lib/german/prepositions';

  /**
   * The prepositions a word goes with, with their case: "auf + Akk; über + Akk". Nothing when
   * empty. With `term`, the one the word is learned with ("warten auf") is left out: Term shows it.
   */
  let { preps, term }: { preps?: string; term?: string } = $props();

  const own = $derived(term ? prepOfCard({ term, preps })?.word : undefined);
  const list = $derived(
    (preps ?? '')
      .split(';')
      .map((p) => p.trim())
      .filter((p) => p && (!own || parsePrepEntry(p)?.word !== own)),
  );
</script>

{#if list.length}
  <div class="preps" lang="de">
    {#each list as p, i}{#if i > 0}<span class="sep">{'; '}</span>{/if}<span class="prep">{p}</span>{/each}
  </div>
{/if}

<style>
  .preps {
    font-size: 14px;
    color: var(--muted);
    overflow-wrap: break-word;
  }
  .prep {
    font-weight: 700;
    color: var(--text);
    white-space: nowrap;
  }
  .sep {
    color: var(--muted);
  }
</style>
