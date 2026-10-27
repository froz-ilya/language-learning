<script lang="ts">
  import { speakableTerm } from '../../lib/german/articles';
  import { speak } from '../../lib/speech/tts';
  import { slideIn } from '../../lib/study/fx';
  import type { ModeProps } from '../../lib/study/modes';
  import Icon from '../Icon.svelte';
  import TypedAnswer from './TypedAnswer.svelte';

  /** Listen mode: hear the German word, type it (article optional). */
  let { item, onanswer, onnext }: ModeProps = $props();

  const text = $derived(speakableTerm(item.card));

  // Speak every new word (iOS may keep the very first one silent until a tap).
  $effect(() => {
    speak(text);
  });
</script>

<div class="stack">
  {#key item.seq}
    <div class="card prompt" in:slideIn>
      <div class="muted small">Type what you hear</div>
      <div class="row buttons">
        <button type="button" class="play" aria-label="Play again" onclick={() => speak(text)}>
          <Icon name="speaker" size={40} />
        </button>
        <button type="button" class="play slow" aria-label="Play slowly" onclick={() => speak(text, { slow: true })}>
          <Icon name="turtle" size={30} />
        </button>
      </div>
    </div>
  {/key}

  <TypedAnswer {item} {onanswer} {onnext} answerGerman={true} requireArticle={false} showTranslation />
</div>

<style>
  .prompt {
    text-align: center;
    padding: 24px 16px;
  }
  .buttons {
    justify-content: center;
    gap: 20px;
    margin-top: 12px;
  }
  .play {
    width: 88px;
    height: 88px;
    border-radius: 50%;
    border: 0;
    background: var(--accent);
    color: var(--accent-text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .play.slow {
    width: 64px;
    height: 64px;
    background: var(--surface-2);
    color: var(--accent);
  }
  .play:active {
    opacity: 0.75;
  }
</style>
