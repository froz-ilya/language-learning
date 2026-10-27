<script lang="ts">
  /** Shimmering placeholder lines while content loads. */
  let { lines = 3 }: { lines?: number } = $props();

  const WIDTHS = [92, 76, 84, 60, 70];
</script>

<div class="skeleton" aria-busy="true" aria-label="Loading">
  {#each { length: lines } as _, i}
    <span class="line" style:width="{i === lines - 1 && lines > 1 ? 45 : WIDTHS[i % WIDTHS.length]}%"></span>
  {/each}
</div>

<style>
  .skeleton {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 4px 0;
  }
  .line {
    display: block;
    height: 14px;
    border-radius: 7px;
    background: linear-gradient(90deg, var(--surface-2) 25%, var(--skeleton-shine) 50%, var(--surface-2) 75%);
    background-size: 300% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }
  @keyframes shimmer {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: 0 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .line {
      animation: none;
    }
  }
</style>
