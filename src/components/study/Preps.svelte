<script lang="ts">
  /** The prepositions a word goes with, with their case: "auf + Akk; über + Akk". Nothing when empty. */
  let { preps }: { preps?: string } = $props();

  const list = $derived(
    (preps ?? '')
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean),
  );
</script>

{#if list.length}
  <div class="preps" lang="de">
    {#each list as p, i}{#if i > 0}<span class="sep">{'; '}</span>{/if}<span class="prep">{p}</span>{/each}
  </div>
{/if}

<style>
  .preps {
    font-size: 14px;
    color: var(--muted);
    overflow-wrap: break-word;
  }
  .prep {
    font-weight: 700;
    color: var(--text);
    white-space: nowrap;
  }
  .sep {
    color: var(--muted);
  }
</style>
