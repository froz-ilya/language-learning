<script lang="ts">
  import type { Card } from '../lib/types';
  import { ARTICLE } from '../lib/german/articles';

  /** German term with its article colored by gender: "der Tisch", "der/das Teil". */
  let { card }: { card: Pick<Card, 'term' | 'pos' | 'genders'> } = $props();
</script>

{#if card.pos === 'noun' && card.genders.length}
  <span class="term"
    >{#each card.genders as g, i}{#if i > 0}<span class="muted">/</span>{/if}<span class="article g-{g}"
        >{ARTICLE[g]}</span
      >{/each}
    <span class="g-{card.genders[0]}">{card.term}</span></span
  >
{:else}
  <span class="term">{card.term}</span>
{/if}

<style>
  .article {
    font-weight: 600;
  }
</style>
