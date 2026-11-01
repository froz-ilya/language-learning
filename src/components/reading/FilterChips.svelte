<script lang="ts">
  /** One filter: its name, then one-choice chips that wrap on narrow screens (radio group). */
  let {
    label,
    options,
    value,
    onpick,
  }: {
    label: string;
    options: { id: string; label: string }[];
    value: string;
    onpick: (id: string) => void;
  } = $props();
</script>

<div class="filter">
  <span class="label" aria-hidden="true">{label}</span>
  <div class="chips" role="radiogroup" aria-label={label}>
    {#each options as o (o.id)}
      <button type="button" role="radio" aria-checked={o.id === value} class:active={o.id === value} onclick={() => onpick(o.id)}>{o.label}</button>
    {/each}
  </div>
</div>

<style>
  .filter {
    display: grid;
    /* Same width on every row, so the chips of all filters line up. */
    grid-template-columns: 52px 1fr;
    gap: 6px;
    margin-bottom: 8px;
  }
  .label {
    font-size: 13px;
    font-weight: 700;
    line-height: 34px;
    color: var(--muted);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
  }
  button {
    min-height: 34px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--muted);
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
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
