<script lang="ts">
  import { displayPlural, displayVerbForms, speakableTerm } from '../../lib/german/articles';
  import { settings } from '../../lib/settings.svelte';
  import { speak } from '../../lib/speech/tts';
  import { Rating, type Grade } from '../../lib/srs/fsrs';
  import type { ModeProps } from '../../lib/study/modes';
  import Meanings from '../Meanings.svelte';
  import SpeakButton from '../SpeakButton.svelte';
  import Term from '../Term.svelte';
  import Examples from './Examples.svelte';
  import NoteHint from './NoteHint.svelte';
  import Preps from './Preps.svelte';
  import SwipeCard, { type SwipeDir } from './SwipeCard.svelte';

  /**
   * Flashcards: tap to flip, then rate Again / Hard / Good / Easy — or swipe the card:
   * right = Good, left = Again. Keyed per question by the parent.
   */
  let { item, onanswer, onnext }: ModeProps = $props();

  const card = $derived(item.card);
  const germanFront = $derived(item.dir === 'de-x');
  const plural = $derived(displayPlural(card));
  const verbForms = $derived(displayVerbForms(card));

  let flipped = $state(false);

  $effect(() => {
    if (germanFront && settings.autoplay) speak(speakableTerm(card));
  });

  function flip() {
    flipped = !flipped;
    if (flipped && !germanFront && settings.autoplay) speak(speakableTerm(card));
  }

  let swipe = $state<SwipeCard>();
  let rated = false;
  let pendingGrade: Grade | null = null;

  function rate(g: Grade) {
    if (rated) return;
    rated = true;
    onanswer(g, g !== Rating.Again);
    onnext();
  }

  /** Rating buttons fly the card off too (Again → left, otherwise right). */
  function rateWithFling(g: Grade) {
    if (rated || pendingGrade !== null) return;
    pendingGrade = g;
    if (swipe) swipe.fling(g === Rating.Again ? 'left' : 'right');
    else rate(g);
  }

  function onswipe(dir: SwipeDir) {
    rate(pendingGrade ?? (dir === 'right' ? Rating.Good : Rating.Again));
  }

  const GRADES: { grade: Grade; label: string; cls: string; key: string }[] = [
    { grade: Rating.Again, label: 'Again', cls: 'again', key: '1' },
    { grade: Rating.Hard, label: 'Hard', cls: 'hard', key: '2' },
    { grade: Rating.Good, label: 'Good', cls: 'good-btn', key: '3' },
    { grade: Rating.Easy, label: 'Easy', cls: 'easy', key: '4' },
  ];

  function onkeydown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      flip();
    } else if (e.key === 'ArrowRight') {
      rateWithFling(Rating.Good);
    } else if (e.key === 'ArrowLeft') {
      rateWithFling(Rating.Again);
    } else if (flipped) {
      const g = GRADES.find((x) => x.key === e.key);
      if (g) rateWithFling(g.grade);
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="stack">
  <SwipeCard bind:this={swipe} {onswipe} ontap={flip} label={flipped ? 'Show front' : 'Show answer'}>
    <div class="scene">
      <div class="flipper" class:flipped>
        <div class="face front card" aria-hidden={flipped}>
          {#if germanFront}
            <div class="row center-row">
              <div class="big"><Term {card} /></div>
              <SpeakButton text={speakableTerm(card)} />
            </div>
          {:else}
            <div class="big"><Meanings translation={card.translation} /></div>
          {/if}
          <div class="hint muted small">Tap to flip · swipe to rate</div>
        </div>

        <div class="face back card" aria-hidden={!flipped}>
          <div class="row center-row">
            <div class="big" class:secondary={germanFront}><Term {card} /></div>
            <SpeakButton text={speakableTerm(card)} />
          </div>
          <div class="translation" class:emph={germanFront}><Meanings translation={card.translation} /></div>
          {#if plural || verbForms || card.preps?.trim()}
            <div class="forms">
              {#if plural}<div>Plural: <span class="g-f">{plural}</span></div>{/if}
              {#if verbForms}<div>{verbForms}</div>{/if}
              <Preps preps={card.preps} />
            </div>
          {/if}
          <NoteHint notes={card.notes} />
          <div class="ex-wrap"><Examples {card} /></div>
        </div>
      </div>
    </div>
  </SwipeCard>

  {#if flipped}
    <div class="grades">
      {#each GRADES as g}
        <button type="button" class="btn btn-lg grade {g.cls}" onclick={() => rateWithFling(g.grade)}>{g.label}</button>
      {/each}
    </div>
  {:else}
    <button type="button" class="btn btn-primary btn-lg btn-block" onclick={flip}>Show answer</button>
  {/if}
</div>

<style>
    .scene {
      perspective: 1200px;
    }
    .flipper {
      display: grid;
      transition: transform 0.4s var(--ease, ease);
      transform-style: preserve-3d;
      -webkit-transform-style: preserve-3d;
    }
    .flipper.flipped {
      transform: rotateY(180deg);
    }
    .face {
      grid-area: 1 / 1;
      min-height: 320px;
      border-radius: var(--radius-lg);
      background: var(--grad-feature);
      box-shadow: var(--shadow-feature);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      text-align: center;
      padding: 24px 16px;
      backface-visibility: hidden;
      -webkit-backface-visibility: hidden;
    }
    .back {
      transform: rotateY(180deg);
    }
    .front .hint {
      margin-top: 12px;
    }
    .center-row {
      justify-content: center;
    }
    .big {
      font-family: var(--font-display);
      font-size: 34px;
      font-weight: 800;
      line-height: 1.15;
      overflow-wrap: anywhere;
    }
    .big.secondary {
      font-size: 28px;
    }
    /* Several meanings: a left-aligned numbered block, centered on the card */
    .big :global(.meanings),
    .translation :global(.meanings) {
      display: inline-flex;
      text-align: left;
    }
    .big :global(.meanings) {
      font-size: 26px;
      gap: 4px;
    }
    .translation {
      font-size: 19px;
      color: var(--text-2);
      overflow-wrap: break-word;
      max-width: 100%;
    }
    .translation.emph {
      font-family: var(--font-display);
      font-size: 24px;
      font-weight: 700;
      color: var(--text);
    }
    /* Several meanings: a calmer size so the list doesn't shout */
    .translation.emph :global(.meanings) {
      font-size: 20px;
      gap: 6px;
    }
    .forms {
      color: var(--muted);
      font-size: 15px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .ex-wrap {
      width: 100%;
    }
    .grades {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
    }
    .grade {
      padding: 10px 4px;
      font-size: 16px;
      color: var(--tone);
      background: color-mix(in srgb, var(--tone) 14%, var(--surface));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone) 22%, transparent);
    }
    .again {
      --tone: var(--bad);
    }
    .hard {
      --tone: var(--warn);
    }
    .good-btn {
      --tone: var(--good);
    }
    .easy {
      --tone: var(--der);
    }
    @media (prefers-reduced-motion: reduce) {
      .flipper {
        transition: none;
      }
    }
  </style>
