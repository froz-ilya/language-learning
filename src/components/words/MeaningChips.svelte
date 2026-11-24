<script lang="ts">
  import { slide } from 'svelte/transition';
  import { dur } from '../../lib/motion';
  import { t } from '../../lib/i18n.svelte';
  import type { CardDraft } from '../../lib/words/cardDraft.svelte';

  /** The looked-up translation's meanings as chips: tap to keep only the ones needed. */
  let { draft }: { draft: CardDraft } = $props();
</script>

<div class="meaning-pick" transition:slide={{ duration: dur(180) }}>
  <div class="meaning-chips" role="group" aria-label={t('words.editor.meanings')}>
    {#each draft.meaningOptions as m, i}
      <button
        type="button"
        class="chip meaning"
        class:active={draft.meaningPicked[i]}
        aria-pressed={draft.meaningPicked[i]}
        onpointerdown={draft.keepFocus}
        onclick={() => draft.toggleMeaning(i)}>{m.join(', ')}</button
      >
    {/each}
  </div>
  <div class="small muted">{t('words.editor.meaningsHint')}</div>
</div>

<style>
  .meaning-pick {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
  }
  .meaning-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .meaning {
    min-height: 36px;
    border: 0;
    box-shadow: inset 0 0 0 1.5px var(--border);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease),
      box-shadow var(--dur-fast) var(--ease);
  }
  .meaning.active {
    box-shadow: inset 0 0 0 1.5px var(--accent);
    background: var(--accent-soft);
    color: var(--text);
  }
</style>
