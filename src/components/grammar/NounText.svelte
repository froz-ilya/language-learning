<script lang="ts">
  import { t } from '../../lib/i18n.svelte';
  import type { LexEntry } from '../../lib/dict/types';
  import { nounOf, openNoun, WORD } from './nouns.svelte';

  /**
   * Plain German text whose nouns can be tapped for their article and meaning. Shown as plain
   * text first; nouns become buttons once the dictionary has them. `start`: the text begins a
   * sentence (false for a piece from the middle of one). The caller sets lang="de".
   */
  let { text, start = true }: { text: string; start?: boolean } = $props();

  let nouns = $state.raw<Map<string, LexEntry>>(new Map());

  /** A word that starts a sentence: the first of `text` when it begins one, or one after . ! ? (see nounOf). */
  function startsSentence(index: number): boolean {
    const before = text.slice(0, index).trimEnd();
    return before === '' ? start : /[.!?]$/.test(before);
  }

  $effect(() => {
    const words = [...text.matchAll(WORD)].map((m) => ({ word: m[0], first: startsSentence(m.index) }));
    let live = true;
    Promise.all(words.map(async ({ word, first }) => [`${first ? '^' : ''}${word}`, await nounOf(word, first)] as const)).then((found) => {
      if (live) nouns = new Map(found.filter((f): f is [string, LexEntry] => f[1] !== null));
    });
    return () => (live = false);
  });

  /** The text split into words and what lies between them. */
  const parts = $derived.by(() => {
    const out: { text: string; key?: string }[] = [];
    let at = 0;
    for (const m of text.matchAll(WORD)) {
      if (m.index > at) out.push({ text: text.slice(at, m.index) });
      out.push({ text: m[0], key: `${startsSentence(m.index) ? '^' : ''}${m[0]}` });
      at = m.index + m[0].length;
    }
    if (at < text.length) out.push({ text: text.slice(at) });
    return out;
  });
</script>

{#each parts as part}{@const entry = part.key ? nouns.get(part.key) : undefined}{#if entry}<button
      type="button"
      class="noun"
      aria-label={t('grammar.noun.show', { word: part.text })}
      onclick={(e) => {
        e.stopPropagation();
        openNoun(entry, part.text);
      }}>{part.text}</button
    >{:else}{part.text}{/if}{/each}

<style>
  /* Reads as text; a dotted line says it can be tapped. */
  .noun {
    display: inline;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-decoration: underline dotted;
    text-decoration-color: var(--faint);
    text-decoration-thickness: 2px;
    text-underline-offset: 4px;
    cursor: pointer;
  }
  .noun:active {
    color: var(--accent);
  }
</style>
