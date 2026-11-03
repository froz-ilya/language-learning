<script lang="ts">
  /**
   * A pattern at a glance: its slots as chips, every verb filled ("…, weil + subject + … + VERB").
   * An ending slot ("-e / -en") is filled like a verb. A "," slot hangs on the slot before it, so a
   * wrapped line never opens with a comma.
   */
  let { text, compact = false }: { text: string; compact?: boolean } = $props();

  const slots = $derived.by(() => {
    const list: { text: string; comma: boolean }[] = [];
    for (const slot of text.split(' + ')) {
      const last = list[list.length - 1];
      if (slot === ',' && last) last.comma = true;
      else list.push({ text: slot, comma: false });
    }
    return list;
  });
</script>

<div class="fslots" class:compact>
  {#each slots as slot}
    <span class="slot">
      <span class="chip" class:verb={/^\p{Lu}{3,}$/u.test(slot.text) || slot.text.startsWith('-')}>{slot.text}</span>{#if slot.comma}<span class="comma">,</span>{/if}
    </span>
  {/each}
</div>

<style>
  .fslots {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .slot {
    display: inline-flex;
    align-items: baseline;
    max-width: 100%;
  }
  .comma {
    margin-left: 2px;
    font-weight: 700;
    color: var(--text-2);
  }
  .chip.verb {
    background: var(--accent-fill);
    color: var(--accent-text);
    font-weight: 800;
    box-shadow: none;
  }
  .compact {
    gap: 4px;
  }
  .compact .chip {
    padding: 1px 7px;
    border-radius: 7px;
    font-size: 12.5px;
    line-height: 1.35;
  }
</style>
