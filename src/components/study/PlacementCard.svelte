<script lang="ts">
  import { speakableTerm } from '../../lib/german/articles';
  import { settings } from '../../lib/settings.svelte';
  import { speak } from '../../lib/speech/tts';
  import type { Card } from '../../lib/types';
  import Icon from '../Icon.svelte';
  import SpeakButton from '../SpeakButton.svelte';
  import Term from '../Term.svelte';
  import SwipeCard, { type SwipeDir } from './SwipeCard.svelte';

  /**
   * Placement word: German term + speaker; tap reveals the translation.
   * Swipe right / "I know it", swipe left / "Don't know". Keyed per word by the parent.
   */
  let { card, onanswer }: { card: Card; onanswer: (knows: boolean) => void } = $props();

  let revealed = $state(false);
  let swipe = $state<SwipeCard>();
  let answered = false;

  $effect(() => {
    if (settings.autoplay) speak(speakableTerm(card));
  });

  function onswipe(dir: SwipeDir) {
    if (answered) return;
    answered = true;
    onanswer(dir === 'right');
  }

  function choose(knows: boolean) {
    if (swipe) swipe.fling(knows ? 'right' : 'left');
    else onswipe(knows ? 'right' : 'left');
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') choose(true);
    else if (e.key === 'ArrowLeft') choose(false);
  }
</script>

<svelte:window {onkeydown} />

<div class="stack">
  <SwipeCard
    bind:this={swipe}
    {onswipe}
    ontap={() => (revealed = !revealed)}
    rightLabel="I know it"
    leftLabel="Don't know"
    label={revealed ? 'Hide translation' : 'Show translation'}
  >
    <div class="card word">
      <div class="row center-row">
        <div class="big"><Term {card} /></div>
        <SpeakButton text={speakableTerm(card)} />
      </div>
      {#if revealed}
        <div class="translation">{card.translation}</div>
      {:else}
        <div class="muted small">Tap to see the translation</div>
      {/if}
    </div>
  </SwipeCard>

  <div class="answers">
    <button type="button" class="btn btn-lg dont" onclick={() => choose(false)}><Icon name="x" size={20} /> Don't know</button>
    <button type="button" class="btn btn-lg know" onclick={() => choose(true)}><Icon name="check" size={20} /> I know it</button>
  </div>
</div>

<style>
  .word {
    min-height: 260px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 26px 18px;
    text-align: center;
    border-radius: var(--radius-lg);
    background: var(--grad-feature);
  }
  .center-row {
    justify-content: center;
  }
  .big {
    font-family: var(--font-display);
    font-size: 34px;
    font-weight: 800;
    overflow-wrap: anywhere;
  }
  .translation {
    font-size: 20px;
    color: var(--text-2);
    overflow-wrap: break-word;
  }
  .answers {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .answers .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .dont {
    color: var(--bad);
    background: color-mix(in srgb, var(--bad) 14%, var(--surface));
  }
  .know {
    color: var(--good);
    background: color-mix(in srgb, var(--good) 14%, var(--surface));
  }
</style>
