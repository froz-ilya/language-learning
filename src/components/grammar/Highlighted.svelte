<script lang="ts">
  import { highlightSegments } from './highlight';

  /**
   * A German sentence with its verb filled and its connector tinted; for a relative clause, the
   * noun its pronoun stands for underlined. The caller sets lang="de".
   */
  let {
    text,
    connector = '',
    verbs = [],
    answer = '',
    noun = '',
  }: { text: string; connector?: string; verbs?: string[]; answer?: string; noun?: string } = $props();

  const segments = $derived(highlightSegments(text, connector, verbs, answer, noun));
</script>

{#each segments as s}{#if s.kind}<span class={s.kind}>{s.text}</span>{:else}{s.text}{/if}{/each}

<style>
  /* The only solid fill in the text: the eye lands on the verb. */
  .v {
    padding: 1px 6px;
    border-radius: 6px;
    background: var(--accent-fill);
    color: var(--accent-text);
    font-weight: 800;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }
  .c {
    color: var(--tier-b);
    font-weight: 800;
  }
  /* Where the pronoun's gender comes from: tied to it by colour, but lighter than a mark. */
  .n {
    text-decoration: underline 2px var(--tier-b);
    text-underline-offset: 3px;
  }
</style>
