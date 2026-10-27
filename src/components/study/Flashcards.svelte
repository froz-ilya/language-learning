<script lang="ts">
  import { displayPlural, displayVerbForms, speakableTerm } from '../../lib/german/articles';
  import { settings } from '../../lib/settings.svelte';
  import { speak } from '../../lib/speech/tts';
  import { Rating, type Grade } from '../../lib/srs/fsrs';
  import type { ModeProps } from '../../lib/study/modes';
  import SpeakButton from '../SpeakButton.svelte';
  import Term from '../Term.svelte';
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
  const examples = $derived(card.examples.filter((e) => e.de.trim()).slice(0, 2));

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
            <div class="big">{card.translation}</div>
          {/if}
          <div class="hint muted small">Tap to flip · swipe to rate</div>
        </div>

        <div class="face back card" aria-hidden={!flipped}>
          <div class="row center-row">
            <div class="big" class:secondary={germanFront}><Term {card} /></div>
            <SpeakButton text={speakableTerm(card)} />
          </div>
          <div class="translation" class:emph={germanFront}>{card.translation}</div>
          {#if plural || verbForms}
            <div class="forms">
              {#if plural}<div>Plural: <span class="g-f">{plural}</span></div>{/if}
              {#if verbForms}<div>{verbForms}</div>{/if}
            </div>
          {/if}
          {#if examples.length}
            <div class="examples">
              {#each examples as ex}
                <div class="example">
                  <div class="row">
                    <div class="ex-de" lang="de">{ex.de}</div>
                    <SpeakButton text={ex.de} size={18} />
                  </div>
                  {#if ex.tr}<div class="muted small">{ex.tr}</div>{/if}
                </div>
              {/each}
            </div>
          {/if}
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
      min-height: 300px;
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
      font-size: 30px;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .big.secondary {
      font-size: 26px;
    }
    .translation {
      font-size: 19px;
    }
    .translation.emph {
      font-size: 24px;
      font-weight: 600;
    }
    .forms {
      color: var(--muted);
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .examples {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 6px;
      text-align: left;
      border-top: 1px solid var(--border);
      padding-top: 10px;
    }
    .example .row {
      justify-content: space-between;
    }
    .ex-de {
      font-style: italic;
    }
    .grades {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
    }
    .grade {
      padding: 10px 4px;
      font-size: 16px;
    }
    .again {
      color: var(--bad);
    }
    .hard {
      color: var(--warn);
    }
    .good-btn {
      color: var(--good);
    }
    .easy {
      color: var(--accent);
    }
    @media (prefers-reduced-motion: reduce) {
      .flipper {
        transition: none;
      }
    }
  </style>
