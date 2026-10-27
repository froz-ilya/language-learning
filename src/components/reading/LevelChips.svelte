<script lang="ts">
  import { LEVELS, LEVEL_TITLES, type LevelCode } from '../../lib/levels/types';

  /** A1…C2 chips (radio group). */
  let { value = $bindable(), onchange }: { value: LevelCode; onchange?: (l: LevelCode) => void } = $props();

  function pick(l: LevelCode) {
    if (l === value) return;
    value = l;
    onchange?.(l);
  }
</script>

<div class="levels" role="radiogroup" aria-label="Level">
  {#each LEVELS as l}
    <button
      type="button"
      role="radio"
      aria-checked={l === value}
      title={LEVEL_TITLES[l]}
      class:active={l === value}
      onclick={() => pick(l)}>{l}</button
    >
  {/each}
</div>

<style>
  .levels {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 6px;
  }
  button {
    min-height: 38px;
    border: 0;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: var(--shadow);
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 15px;
    color: var(--text);
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease),
      transform var(--dur-fast) var(--ease);
  }
  button:active {
    transform: scale(0.94);
  }
  button.active {
    background: var(--accent-fill);
    color: var(--accent-text);
    box-shadow: var(--shadow-accent);
  }
  button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--focus-ring);
  }
</style>
