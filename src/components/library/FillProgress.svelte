<script lang="ts">
  /** Progress card for dictionary auto-fill: "Filling details… 12 / 40" + bar + Cancel. */
  let {
    done,
    total,
    label = 'Filling in details…',
    oncancel,
  }: { done: number; total: number; label?: string; oncancel?: () => void } = $props();

  const pct = $derived(total ? Math.round((done / total) * 100) : 0);
</script>

<div class="card fill">
  <div class="row">
    <span class="small">{label}</span>
    <span class="spacer"></span>
    <span class="small muted">{done} / {total}</span>
  </div>
  <div class="bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
    <div class="value" style:width="{pct}%"></div>
  </div>
  {#if oncancel}
    <button class="btn btn-ghost btn-block" onclick={oncancel}>Cancel</button>
  {/if}
</div>

<style>
  .fill {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .bar {
    height: 8px;
    border-radius: 999px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .value {
    height: 100%;
    border-radius: inherit;
    background: var(--accent-bar);
    transition: width 0.2s;
  }
</style>
