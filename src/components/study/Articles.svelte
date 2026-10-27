<script lang="ts">
  import { ARTICLE, displayPlural, speakableTerm } from '../../lib/german/articles';
  import { settings } from '../../lib/settings.svelte';
  import { speak } from '../../lib/speech/tts';
  import { gradeForResult } from '../../lib/srs/fsrs';
  import { feedbackFx } from '../../lib/study/fx';
  import type { ModeProps } from '../../lib/study/modes';
  import type { Gender } from '../../lib/types';
  import Term from '../Term.svelte';
  import SpeakButton from '../SpeakButton.svelte';
  import ResultIcon from './ResultIcon.svelte';
  import NoteHint from './NoteHint.svelte';

  /** der / die / das drill. Keyed per question by the parent. */
  let { item, onanswer, onnext }: ModeProps = $props();

  const card = $derived(item.card);
  const GENDERS: Gender[] = ['m', 'f', 'n'];

  let picked = $state<Gender | null>(null);
  const correct = $derived(picked !== null && card.genders.includes(picked));

  function pick(g: Gender) {
    if (picked) return;
    picked = g;
    const ok = card.genders.includes(g);
    onanswer(gradeForResult(ok), ok);
    if (settings.autoplay) speak(speakableTerm(card));
  }

  function onkeydown(e: KeyboardEvent) {
    if (!picked) {
      const g = ({ '1': 'm', '2': 'f', '3': 'n', r: 'm', e: 'f', s: 'n' } as Record<string, Gender>)[e.key];
      if (g) pick(g);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onnext();
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="stack">
  <div class="card prompt">
    <div class="big">{card.term}</div>
    <div class="muted">{card.translation}</div>
  </div>

  <div class="articles">
    {#each GENDERS as g}
      <button
        type="button"
        class="article a-{g}"
        class:right={picked !== null && card.genders.includes(g)}
        class:wrong={picked === g && !card.genders.includes(g)}
        class:dim={picked !== null && picked !== g && !card.genders.includes(g)}
        disabled={picked !== null}
        onclick={() => pick(g)}
        {@attach feedbackFx(picked === g ? (card.genders.includes(g) ? 'good' : 'bad') : null)}>{ARTICLE[g]}</button
      >
    {/each}
  </div>

  {#if picked}
    <div class="card feedback" class:ok={correct} class:no={!correct}>
      <div class="head row"><ResultIcon ok={correct} />{correct ? 'Correct!' : 'Not quite'}</div>
      <div class="row result-row">
        <div class="term"><Term {card} /></div>
        <SpeakButton text={speakableTerm(card)} />
      </div>
      {#if card.plural}<div class="muted">Plural: {displayPlural(card)}</div>{/if}
      {#if !correct}<NoteHint notes={card.notes} />{/if}
    </div>
    <button type="button" class="btn btn-primary btn-lg btn-block" onclick={onnext}>Continue</button>
  {/if}
</div>

<style>
  .prompt {
    text-align: center;
    padding: 34px 18px;
    border-radius: var(--radius-lg);
    background: var(--grad-feature);
  }
  .prompt .muted {
    margin-top: 4px;
    overflow-wrap: break-word;
  }
  .big {
    font-family: var(--font-display);
    font-size: 36px;
    font-weight: 800;
    overflow-wrap: anywhere;
  }
  .articles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  /* Each article is a tinted tile in its gender color */
  .article {
    min-height: 84px;
    border-radius: var(--radius);
    border: 0;
    color: var(--g);
    background: color-mix(in srgb, var(--g) 15%, var(--surface));
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--g) 35%, transparent);
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 900;
    cursor: pointer;
    transition:
      opacity 0.22s ease,
      box-shadow 0.22s ease,
      transform 0.12s ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .article {
      transition: none;
    }
  }
  .a-m {
    --g: var(--der);
  }
  .a-f {
    --g: var(--die);
  }
  .a-n {
    --g: var(--das);
  }
  .article:disabled {
    cursor: default;
  }
  .article:not(:disabled):active {
    opacity: 0.75;
    transform: scale(0.97);
  }
  .article.right {
    background: var(--g);
    color: var(--on-tone);
    box-shadow:
      0 0 0 2px var(--bg),
      0 0 0 4.5px var(--good);
  }
  .article.wrong {
    box-shadow:
      0 0 0 2px var(--bg),
      0 0 0 4.5px var(--bad);
  }
  .article.dim {
    opacity: 0.35;
  }
  .feedback {
    --tone: var(--border);
    background: color-mix(in srgb, var(--tone) 10%, var(--surface));
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--tone) 55%, transparent);
  }
  .feedback.ok {
    --tone: var(--good);
  }
  .feedback.no {
    --tone: var(--bad);
  }
  .head {
    font-family: var(--font-display);
    font-weight: 800;
    color: var(--tone);
  }
  .result-row {
    justify-content: space-between;
  }
  .term {
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 800;
  }
</style>
