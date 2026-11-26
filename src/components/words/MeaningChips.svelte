<script lang="ts">
  import { slide } from 'svelte/transition';
  import { dur } from '../../lib/motion';
  import { t } from '../../lib/i18n.svelte';
  import { settings } from '../../lib/settings.svelte';
  import type { CardDraft } from '../../lib/words/cardDraft.svelte';

  /**
   * The looked-up translation's words as separate tiles, each a toggle in the look of a segmented
   * switcher's segment: picked = the switcher's selected segment. Words of one meaning
   * ("последствие, результат") sit closer together than meanings. On the add card they stand in
   * for the translation line. The last picked tile can't be turned off: it doesn't toggle and
   * gives a small nudge instead.
   */
  let { draft }: { draft: CardDraft } = $props();

  let nudged = $state('');

  function tap(i: number, j: number) {
    if (draft.lastPicked(i, j)) {
      nudged = '';
      requestAnimationFrame(() => (nudged = `${i}:${j}`)); // re-trigger the animation on every tap
      return;
    }
    draft.toggleMeaning(i, j);
  }
</script>

<div class="meanings" role="group" aria-label={t('words.editor.meanings')} transition:slide={{ duration: dur(180) }}>
  {#each draft.meaningOptions as m, i}
    <div class="group">
      {#each m as w, j}
        {@const picked = !!draft.wordPicked[i]?.[j]}
        {@const locked = draft.lastPicked(i, j)}
        <button
          type="button"
          class="meaning"
          class:active={picked}
          class:locked
          class:nudge={nudged === `${i}:${j}`}
          aria-pressed={picked}
          aria-disabled={locked || undefined}
          lang={settings.lang}
          onpointerdown={draft.keepFocus}
          onanimationend={() => (nudged = '')}
          onclick={() => tap(i, j)}>{w}</button
        >
      {/each}
    </div>
  {/each}
</div>

<style>
  .meanings {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    margin: 2px 0 4px;
  }
  /* One meaning's words: closer together than meanings. */
  .group {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    max-width: 100%;
  }
  /* An unpicked tile is a switcher's well with an unselected segment in it; picked, the segment. */
  .meaning {
    min-width: 44px;
    max-width: 100%;
    min-height: 38px;
    padding: 7px 13px;
    border: 0;
    border-radius: 10px;
    background: var(--seg-bg);
    box-shadow: inset 0 0 0 1px var(--hairline);
    color: var(--muted);
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 15px;
    line-height: 1.25;
    text-align: left;
    overflow-wrap: anywhere;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease),
      box-shadow var(--dur-fast) var(--ease),
      transform var(--dur-fast) var(--ease);
  }
  .meaning:active:not(.locked) {
    transform: scale(0.96);
  }
  .meaning.active {
    background: var(--seg-active);
    color: var(--text);
    box-shadow:
      inset 0 0 0 1px var(--hairline),
      var(--shadow-sm);
  }
  .meaning.locked {
    cursor: default;
  }
  .meaning:focus-visible {
    outline: none;
    box-shadow:
      0 0 0 3px var(--focus-ring),
      inset 0 0 0 1.5px var(--accent);
  }
  .nudge {
    animation: nudge 0.3s var(--ease-in-out);
  }
  @keyframes nudge {
    25% {
      transform: translateX(-3px);
    }
    50% {
      transform: translateX(3px);
    }
    75% {
      transform: translateX(-1px);
    }
  }
</style>
