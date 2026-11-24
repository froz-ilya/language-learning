<script lang="ts">
  import type { Card } from '../lib/types';
  import { ARTICLE } from '../lib/german/articles';
  import { prepOfCard } from '../lib/german/prepositions';

  /**
   * German term with its article colored by gender: "der Tisch", "der/das Teil". A word learned
   * with its preposition shows the case after it: "warten auf + Akk".
   */
  let { card }: { card: Pick<Card, 'term' | 'pos' | 'genders'> & { preps?: string } } = $props();

  const prepCase = $derived(prepOfCard(card)?.case);
</script>

{#if card.pos === 'noun' && card.genders.length}
  <span class="term"
    >{#each card.genders as g, i}{#if i > 0}<span class="muted">/</span>{/if}<span class="article g-{g}"
        >{ARTICLE[g]}</span
      >{/each}
    <span class="g-{card.genders[0]}">{card.term}</span>{#if prepCase}<span class="case">+ {prepCase}</span>{/if}</span
  >
{:else}
  <span class="term">{card.term}{#if prepCase}<span class="case">+ {prepCase}</span>{/if}</span>
{/if}

<style>
  .article {
    font-weight: 700;
  }
  .case {
    margin-left: 0.3em;
    font-size: 0.7em;
    font-weight: 600;
    color: var(--muted);
    white-space: nowrap;
  }
</style>
