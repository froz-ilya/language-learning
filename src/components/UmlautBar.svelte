<script lang="ts">
  /**
   * Buttons for ä ö ü ß (+ capitals with shift) that insert into the given input
   * at the cursor without losing focus (keeps the iOS keyboard open). A tap also puts the
   * cursor back into the input when it wasn't focused (focus() inside the tap opens the keyboard on iOS).
   */
  let {
    input,
    oninsert,
  }: { input: HTMLInputElement | HTMLTextAreaElement | undefined; oninsert?: (value: string) => void } = $props();

  let upper = $state(false);
  const letters = $derived(upper ? ['Ä', 'Ö', 'Ü', 'ẞ'] : ['ä', 'ö', 'ü', 'ß']);

  function refocus() {
    if (input && document.activeElement !== input) input.focus({ preventScroll: true });
  }

  function toggleUpper() {
    upper = !upper;
    refocus();
  }

  function insert(ch: string) {
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + ch + input.value.slice(end);
    refocus();
    input.setSelectionRange(start + ch.length, start + ch.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    oninsert?.(input.value);
    upper = false;
  }
</script>

<div class="bar">
  <button type="button" class:active={upper} onpointerdown={(e) => e.preventDefault()} onclick={toggleUpper}>⇧</button>
  {#each letters as ch}
    <button type="button" onpointerdown={(e) => e.preventDefault()} onclick={() => insert(ch)}>{ch}</button>
  {/each}
</div>

<style>
  .bar {
    display: flex;
    gap: 6px;
  }
  button {
    flex: 1;
    min-height: 40px;
    border: 0;
    border-radius: 12px;
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--hairline);
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 700;
    transition: transform var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease);
  }
  button:active {
    transform: scale(0.94);
    background: var(--surface-2);
    cursor: pointer;
  }
  button.active {
    background: var(--accent-fill);
    color: var(--accent-text);
  }
</style>
