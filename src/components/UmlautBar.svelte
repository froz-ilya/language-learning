<script lang="ts">
  /**
   * Buttons for ä ö ü ß (+ capitals with shift) that insert into the given input
   * at the cursor without losing focus (keeps the iOS keyboard open).
   */
  let {
    input,
    oninsert,
  }: { input: HTMLInputElement | HTMLTextAreaElement | undefined; oninsert?: (value: string) => void } = $props();

  let upper = $state(false);
  const letters = $derived(upper ? ['Ä', 'Ö', 'Ü', 'ẞ'] : ['ä', 'ö', 'ü', 'ß']);

  function insert(ch: string) {
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + ch + input.value.slice(end);
    input.setSelectionRange(start + ch.length, start + ch.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    oninsert?.(input.value);
    upper = false;
  }
</script>

<div class="bar">
  <button type="button" class:active={upper} onpointerdown={(e) => e.preventDefault()} onclick={() => (upper = !upper)}>⇧</button>
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
    border-radius: 8px;
    background: var(--surface-2);
    font-size: 18px;
    font-weight: 600;
    cursor: pointer;
  }
  button.active {
    background: var(--accent);
    color: var(--accent-text);
  }
</style>
