<script lang="ts">
  import { backOut } from 'svelte/easing';
  import { scale } from 'svelte/transition';
  import { dur } from '../../lib/motion';
  import Icon from '../Icon.svelte';

  /** Check (correct) or cross (wrong) badge that pops in. */
  let { ok, size = 16 }: { ok: boolean; size?: number } = $props();
</script>

<span
  class="result-icon"
  class:ok
  class:no={!ok}
  style:--s="{size + 10}px"
  aria-hidden="true"
  in:scale|global={{ start: 0.3, duration: dur(320), easing: backOut }}
>
  <Icon name={ok ? 'check' : 'x'} {size} />
</span>

<style>
  .result-icon {
    width: var(--s);
    height: var(--s);
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--on-tone);
  }
  .ok {
    background: var(--good);
  }
  .no {
    background: var(--bad);
  }
</style>
