<script lang="ts">
  import { lemmatize } from '../../lib/dict/local';
  import { markExample, type MarkedPart } from '../../lib/german/highlight';
  import type { Card } from '../../lib/types';
  import SpeakButton from '../SpeakButton.svelte';

  /**
   * The card's example sentences, shown after an answer: the first one right away, the rest
   * behind "More examples". The card's word is marked in each sentence; translations stay
   * hidden until "Show translation" is tapped (reading the German comes first). Taps don't
   * reach the parent (a flashcard flips on tap).
   */
  let { card }: { card: Card } = $props();

  const MAX = 3;
  const examples = $derived(card.examples.filter((e) => e.de.trim()).slice(0, MAX));

  let showAll = $state(false);
  let shownTr = $state(new Set<number>());

  /** Marked sentences; the plain sentence until marking is ready. */
  let marked = $state<MarkedPart[][]>([]);
  $effect(() => {
    const list = examples;
    const c = card;
    let cancelled = false;
    marked = list.map((e) => [{ text: e.de, hit: false }]);
    const lemmaOf = async (t: string) => (await lemmatize(t))?.term ?? null;
    void Promise.all(list.map((e) => markExample(e.de, c, lemmaOf))).then((m) => {
      if (!cancelled) marked = m;
    });
    return () => {
      cancelled = true;
    };
  });

  const visible = $derived(showAll ? examples : examples.slice(0, 1));

  function toggleTr(i: number) {
    const next = new Set(shownTr);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    shownTr = next;
  }
</script>

{#if examples.length}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="examples" onclick={(e) => e.stopPropagation()} onpointerdown={(e) => e.stopPropagation()}>
    {#each visible as ex, i (i)}
      <div class="example">
        <div class="row">
          <p class="de" lang="de">
            {#each marked[i] ?? [{ text: ex.de, hit: false }] as part}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}
          </p>
          <SpeakButton text={ex.de} size={18} />
        </div>
        {#if ex.tr?.trim()}
          {#if shownTr.has(i)}
            <button type="button" class="tr" onclick={() => toggleTr(i)}>{ex.tr}</button>
          {:else}
            <button type="button" class="link" onclick={() => toggleTr(i)}>Show translation</button>
          {/if}
        {/if}
      </div>
    {/each}
    {#if examples.length > 1 && !showAll}
      <button type="button" class="link more" onclick={() => (showAll = true)}>
        More examples ({examples.length - 1})
      </button>
    {/if}
  </div>
{/if}

<style>
  .examples {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--hairline);
    text-align: left;
  }
  .example {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }
  .de {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding-top: 6px;
    font-family: var(--font-read);
    font-size: 17px;
    line-height: 1.45;
    color: var(--text-read);
    overflow-wrap: break-word;
  }
  mark {
    background: none;
    color: var(--accent);
    font-weight: 700;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--accent) 45%, transparent);
    text-underline-offset: 3px;
  }
  .link,
  .tr {
    align-self: flex-start;
    border: 0;
    background: none;
    padding: 4px 0;
    font: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
  }
  .link {
    color: var(--accent);
    font-weight: 600;
  }
  .tr {
    color: var(--muted);
    overflow-wrap: break-word;
  }
  .more {
    margin-top: -4px;
  }
</style>
