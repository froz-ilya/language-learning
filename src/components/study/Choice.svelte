<script lang="ts">
  import { displayTerm, speakableTerm } from '../../lib/german/articles';
  import { settings } from '../../lib/settings.svelte';
  import { speak } from '../../lib/speech/tts';
  import { gradeForResult } from '../../lib/srs/fsrs';
  import type { ModeProps } from '../../lib/study/modes';
  import { choiceOptions } from '../../lib/study/quiz';
  import { feedbackFx } from '../../lib/study/fx';
  import type { Card } from '../../lib/types';
  import ResultIcon from './ResultIcon.svelte';
  import SpeakButton from '../SpeakButton.svelte';
  import Term from '../Term.svelte';

  /** Multiple choice: pick the answer out of 4. Keyed per question by the parent. */
  let { item, onanswer, onnext, pool }: ModeProps & { pool: Card[] } = $props();

  const card = $derived(item.card);
  const answerGerman = $derived(item.dir === 'x-de');
  const options = $derived(choiceOptions(item.card, pool, answerGerman ? displayTerm : (c) => c.translation, 4));

  let picked = $state<number | null>(null);
  const isRight = (o: Card) => o === card;

  $effect(() => {
    if (!answerGerman && settings.autoplay) speak(speakableTerm(card));
  });

  function pick(i: number) {
    if (picked !== null) return;
    picked = i;
    const correct = isRight(options[i]);
    onanswer(gradeForResult(correct), correct);
    if (answerGerman && settings.autoplay) speak(speakableTerm(card));
  }

  function onkeydown(e: KeyboardEvent) {
    if (picked === null) {
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) pick(n - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onnext();
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="stack">
  <div class="card prompt">
    <div class="muted small">{answerGerman ? 'Choose the German word' : 'Choose the translation'}</div>
    {#if answerGerman}
      <div class="big tr">{card.translation}</div>
    {:else}
      <div class="row center-row">
        <div class="big"><Term {card} /></div>
        <SpeakButton text={speakableTerm(card)} />
      </div>
    {/if}
  </div>

  <div class="options">
    {#each options as o, i}
      <button
        type="button"
        class="option"
        class:right={picked !== null && isRight(o)}
        class:wrong={picked === i && !isRight(o)}
        class:dim={picked !== null && picked !== i && !isRight(o)}
        disabled={picked !== null}
        onclick={() => pick(i)}
        {@attach feedbackFx(picked === i ? (isRight(o) ? 'good' : 'bad') : null)}
      >
        <span class="key" aria-hidden="true">{i + 1}</span>
        <span class="label">{#if answerGerman}<Term card={o} />{:else}{o.translation}{/if}</span>
        {#if picked !== null && isRight(o)}<ResultIcon ok />{:else if picked === i}<ResultIcon ok={false} />{/if}
      </button>
    {/each}
  </div>

  {#if picked !== null}
    <button type="button" class="btn btn-primary btn-lg btn-block" onclick={onnext}>Continue</button>
  {/if}
</div>

<style>
  .prompt {
    text-align: center;
    padding: 30px 18px;
    border-radius: var(--radius-lg);
    background: var(--grad-feature);
  }
  .center-row {
    justify-content: center;
  }
  .big {
    font-family: var(--font-display);
    font-size: 32px;
    font-weight: 800;
    line-height: 1.2;
    margin-top: 6px;
    overflow-wrap: anywhere;
  }
  .big.tr {
    font-size: 24px;
    font-weight: 700;
    overflow-wrap: break-word;
  }
  .options {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .option {
    --tone: var(--hairline);
    min-height: 60px;
    padding: 12px 14px 12px 12px;
    border-radius: var(--radius);
    border: 0;
    background: var(--surface);
    box-shadow: inset 0 0 0 1.5px var(--tone);
    font-size: 18px;
    line-height: 1.3;
    text-align: left;
    cursor: pointer;
    overflow-wrap: break-word;
    display: flex;
    align-items: center;
    gap: 12px;
    transition:
      background-color 0.22s ease,
      box-shadow 0.22s ease,
      opacity 0.22s ease,
      transform 0.12s ease;
  }
  .key {
    display: inline-grid;
    place-items: center;
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--muted);
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 800;
    transition:
      background-color 0.22s ease,
      color 0.22s ease;
  }
  /* (overrides the global form .label style) */
  .label {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: inherit;
    font-weight: 500;
    color: inherit;
  }
  .label :global(.term) {
    font-family: var(--font-display);
    font-weight: 800;
  }
  .option:not(:disabled):active {
    transform: scale(0.98);
  }
  @media (prefers-reduced-motion: reduce) {
    .option {
      transition: none;
    }
    .option:not(:disabled):active {
      transform: none;
    }
  }
  .option:disabled {
    cursor: default;
    color: inherit;
  }
  .option:not(:disabled):active {
    background: var(--surface-2);
  }
  .option.right {
    --tone: var(--good);
    background: color-mix(in srgb, var(--good) 13%, var(--surface));
  }
  .option.wrong {
    --tone: var(--bad);
    background: color-mix(in srgb, var(--bad) 13%, var(--surface));
  }
  .option.right .key,
  .option.wrong .key {
    background: var(--tone);
    color: var(--on-tone);
  }
  .option.dim {
    opacity: 0.5;
  }
</style>
