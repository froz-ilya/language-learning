<script lang="ts">
  import { endingSegments } from './highlight';
  import NounText from './NounText.svelte';

  /**
   * A German sentence with the endings of its marked words filled ("rot|en"). With `nouns`, its
   * nouns can be tapped for their article (needs a NounSheet on the page). The caller sets lang="de".
   */
  let { text, marks = [], nouns = false }: { text: string; marks?: string[]; nouns?: boolean } = $props();

  const segments = $derived(endingSegments(text, marks));
</script>

{#each segments as s, i}{#if s.kind}<span class={s.kind}>{s.text}</span>{:else if nouns}<NounText text={s.text} start={i === 0} />{:else}{s.text}{/if}{/each}

<style>
  /* The ending is the only solid fill, as the verb is in word order. It hugs its stem. */
  .e {
    padding: 1px 3px;
    border-radius: 5px;
    background: var(--accent-fill);
    color: var(--accent-text);
    font-weight: 800;
  }
  .c {
    color: var(--tier-b);
    font-weight: 800;
  }
</style>
