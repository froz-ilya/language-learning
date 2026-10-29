<script lang="ts">
  import { settings } from '../../lib/settings.svelte';
  import { speak } from '../../lib/speech/tts';
  import { gradeForResult, Rating } from '../../lib/srs/fsrs';
  import { feedbackFx } from '../../lib/study/fx';
  import type { ModeProps } from '../../lib/study/modes';
  import { pronounOptions, pronounQuestion } from '../../lib/study/pronouns';
  import Term from '../Term.svelte';
  import SpeakButton from '../SpeakButton.svelte';
  import ResultIcon from './ResultIcon.svelte';
  import NoteHint from './NoteHint.svelte';
  import Preps from './Preps.svelte';

  /** Reflexive pronoun drill: "Ich freue ___ auf dich." → mich. Keyed per question by the parent. */
  let { item, onanswer, onnext }: ModeProps = $props();

  const card = $derived(item.card);
  const q = $derived(pronounQuestion(card));
  const options = $derived(q ? pronounOptions(q.pronoun) : []);

  let picked = $state<string | null>(null);
  const correct = $derived(picked !== null && picked === q?.pronoun);

  function pick(p: string) {
    if (picked || !q) return;
    picked = p;
    const ok = p === q.pronoun;
    onanswer(gradeForResult(ok), ok);
    if (settings.autoplay) speak(q.example.de);
  }

  /** Only cards with a question reach this mode (modeApplies); just in case, let it pass. */
  function skip() {
    if (picked) return;
    picked = '';
    onanswer(Rating.Good, true);
    onnext();
  }

  function onkeydown(e: KeyboardEvent) {
    if (!picked) {
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) pick(options[n - 1]);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onnext();
    }
  }
</script>

<svelte:window {onkeydown} />

{#if q}
  <div class="stack">
    <div class="card prompt">
      <div class="muted small">Fill in the pronoun</div>
      <p class="sentence" lang="de">
        {q.before}{#if picked}<span class="filled" class:ok={correct} class:no={!correct}>{q.text}</span
          >{:else}<span class="blank" aria-label="blank">___</span>{/if}{q.after}
      </p>
      {#if q.example.tr?.trim()}<div class="muted tr">{q.example.tr}</div>{/if}
      <div class="word small"><span lang="de">{card.term}</span> · <span class="muted">{card.translation}</span></div>
    </div>

    <div class="options">
      {#each options as p, i}
        <button
          type="button"
          class="option"
          lang="de"
          class:right={picked !== null && p === q.pronoun}
          class:wrong={picked === p && p !== q.pronoun}
          class:dim={picked !== null && picked !== p && p !== q.pronoun}
          disabled={picked !== null}
          onclick={() => pick(p)}
          {@attach feedbackFx(picked === p ? (p === q.pronoun ? 'good' : 'bad') : null)}
        >
          <span class="key" aria-hidden="true">{i + 1}</span>{p}
        </button>
      {/each}
    </div>

    {#if picked}
      <div class="card feedback" class:ok={correct} class:no={!correct} role="status">
        <div class="head row"><ResultIcon ok={correct} />{correct ? 'Correct!' : `It's “${q.pronoun}”`}</div>
        <div class="row result-row">
          <p class="full" lang="de">{q.before}<mark>{q.text}</mark>{q.after}</p>
          <SpeakButton text={q.example.de} size={18} />
        </div>
        <div class="row result-row">
          <div class="term"><Term {card} /></div>
          <SpeakButton text={card.term} />
        </div>
        <Preps preps={card.preps} />
        {#if !correct}<NoteHint notes={card.notes} />{/if}
      </div>
      <button type="button" class="btn btn-primary btn-lg btn-block" onclick={onnext}>Continue</button>
    {/if}
  </div>
{:else}
  <div class="stack">
    <div class="empty">This word has no example with a reflexive pronoun.</div>
    <button type="button" class="btn btn-primary btn-lg btn-block" onclick={skip}>Skip</button>
  </div>
{/if}

<style>
  .prompt {
    text-align: center;
    padding: 28px 18px;
    border-radius: var(--radius-lg);
    background: var(--grad-feature);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sentence {
    margin: 0;
    font-family: var(--font-display);
    font-size: 24px;
    font-weight: 800;
    line-height: 1.35;
    overflow-wrap: break-word;
  }
  .blank {
    color: var(--accent);
    letter-spacing: 0.05em;
  }
  .filled.ok {
    color: var(--good);
  }
  .filled.no {
    color: var(--bad);
  }
  .tr {
    overflow-wrap: break-word;
  }
  .word {
    margin-top: 4px;
    overflow-wrap: break-word;
  }
  .options {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  .option {
    position: relative;
    min-height: 64px;
    border-radius: var(--radius);
    border: 0;
    color: var(--text);
    background: var(--surface);
    box-shadow: inset 0 0 0 1.5px var(--border);
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 800;
    cursor: pointer;
    transition:
      opacity 0.22s ease,
      box-shadow 0.22s ease,
      transform 0.12s ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .option {
      transition: none;
    }
  }
  .key {
    position: absolute;
    top: 6px;
    left: 9px;
    font-size: 11px;
    font-weight: 700;
    color: var(--muted);
  }
  .option:disabled {
    cursor: default;
  }
  .option:not(:disabled):active {
    opacity: 0.75;
    transform: scale(0.97);
  }
  .option.right {
    box-shadow:
      0 0 0 2px var(--bg),
      0 0 0 4.5px var(--good);
    color: var(--good);
  }
  .option.wrong {
    box-shadow:
      0 0 0 2px var(--bg),
      0 0 0 4.5px var(--bad);
    color: var(--bad);
  }
  .option.dim {
    opacity: 0.35;
  }
  .feedback {
    --tone: var(--border);
    background: color-mix(in srgb, var(--tone) 10%, var(--surface));
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--tone) 55%, transparent);
    display: flex;
    flex-direction: column;
    gap: 6px;
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
    align-items: flex-start;
  }
  .full {
    margin: 0;
    min-width: 0;
    font-size: 17px;
    line-height: 1.4;
    overflow-wrap: break-word;
  }
  mark {
    background: none;
    color: var(--accent);
    font-weight: 700;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--accent) 45%, transparent);
    text-underline-offset: 3px;
  }
  .term {
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 800;
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
