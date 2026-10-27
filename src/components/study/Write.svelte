<script lang="ts">
  import { speakableTerm } from '../../lib/german/articles';
  import { settings } from '../../lib/settings.svelte';
  import { speak } from '../../lib/speech/tts';
  import { slideIn } from '../../lib/study/fx';
  import type { ModeProps } from '../../lib/study/modes';
  import SpeakButton from '../SpeakButton.svelte';
  import Term from '../Term.svelte';
  import TypedAnswer from './TypedAnswer.svelte';

  /** Write mode: see one side, type the other. */
  let { item, onanswer, onnext }: ModeProps = $props();

  const answerGerman = $derived(item.dir === 'x-de');

  // Autoplay the German prompt on each new question.
  $effect(() => {
    if (item.dir === 'de-x' && settings.autoplay) speak(speakableTerm(item.card));
  });
</script>

<div class="stack">
  {#key item.seq}
    <div class="card prompt" in:slideIn>
      <div class="muted small">{answerGerman ? 'Translate into German' : 'Translate'}</div>
      {#if answerGerman}
        <div class="big tr">{item.card.translation}</div>
      {:else}
        <div class="row center-row">
          <div class="big"><Term card={item.card} /></div>
          <SpeakButton text={speakableTerm(item.card)} />
        </div>
      {/if}
    </div>
  {/key}

  <TypedAnswer {item} {onanswer} {onnext} {answerGerman} speakAfter={answerGerman && settings.autoplay} />
</div>

<style>
  .prompt {
    text-align: center;
    padding: 30px 18px;
    border-radius: var(--radius-lg);
    background: var(--grad-feature);
  }
  .big {
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 800;
    line-height: 1.2;
    overflow-wrap: break-word;
    margin-top: 6px;
    overflow-wrap: anywhere;
  }
  .big.tr {
    font-size: 25px;
    font-weight: 700;
  }
  .center-row {
    justify-content: center;
  }
</style>
