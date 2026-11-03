<script lang="ts">
  import { untrack } from 'svelte';
  import { ORDER_TOPICS } from '../../lib/grammar/content';
  import { CASE_NAMES, GENDER_NAMES } from '../../lib/grammar/endings';
  import { fullSentence, marksOf } from '../../lib/grammar/practice';
  import type { PickExercise } from '../../lib/grammar/types';
  import { i18n, t } from '../../lib/i18n.svelte';
  import { settings } from '../../lib/settings.svelte';
  import { speak } from '../../lib/speech/tts';
  import { shuffle } from '../../lib/study/session';
  import { feedbackFx } from '../../lib/study/fx';
  import NoteHint from '../study/NoteHint.svelte';
  import ResultIcon from '../study/ResultIcon.svelte';
  import SpeakButton from '../SpeakButton.svelte';
  import Highlighted from './Highlighted.svelte';

  /** Pick the word that fits the blank. Keyed per question by the parent. */
  let {
    exercise,
    onanswer,
    onnext,
  }: { exercise: PickExercise; onanswer: (ok: boolean) => void; onnext: () => void } = $props();

  const options = untrack(() => shuffle(exercise.options));

  let picked = $state<string | null>(null);
  const correct = $derived(picked === exercise.answer);

  const sentence = $derived(fullSentence(exercise));
  /** The text around the blank, spaced as in the finished sentence. */
  const before = $derived(exercise.before.trim() ? `${exercise.before.trim()} ` : '');
  const after = $derived.by(() => {
    const text = exercise.after.trim();
    return text && !/^[,.!?;:]/.test(text) ? ` ${text}` : text;
  });
  /** At the start of the sentence the answer takes the capital. */
  const shown = $derived(
    before ? exercise.answer : exercise.answer.charAt(0).toLocaleUpperCase('de') + exercise.answer.slice(1),
  );
  const note = $derived(
    ORDER_TOPICS.find((topic) => topic.exercises.some((ex) => ex.id === exercise.id))?.connectors.find(
      (c) => c.word === exercise.connector,
    )?.note?.[i18n.lang],
  );

  function pick(option: string) {
    if (picked !== null) return;
    picked = option;
    onanswer(option === exercise.answer);
    if (settings.autoplay) speak(sentence);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.repeat) return;
    if (picked === null) {
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) pick(options[n - 1]);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onnext();
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="stack">
  <div class="card prompt">
    <div class="muted small">{t('grammar.pickPrompt')}</div>
    <p class="sentence" lang="de">
      {before}{#if picked !== null}<span class="filled" class:ok={correct} class:no={!correct}>{shown}</span
        >{:else}<span class="blank" aria-label={t('grammar.blank')} lang={i18n.lang}>___</span>{/if}{after}
    </p>
    {#if picked !== null}<div class="muted tr">{exercise.tr[settings.lang]}</div>{/if}
  </div>

  <div class="options">
    {#each options as option, i}
      <button
        type="button"
        class="option"
        lang="de"
        class:right={picked !== null && option === exercise.answer}
        class:wrong={picked === option && option !== exercise.answer}
        class:dim={picked !== null && picked !== option && option !== exercise.answer}
        disabled={picked !== null}
        onclick={() => pick(option)}
        {@attach feedbackFx(picked === option ? (option === exercise.answer ? 'good' : 'bad') : null)}
      >
        <span class="key" aria-hidden="true">{i + 1}</span>{option}
      </button>
    {/each}
  </div>

  {#if picked !== null}
    <div class="card feedback" class:ok={correct} class:no={!correct} role="status">
      <div class="head row"><ResultIcon ok={correct} />{correct ? t('study.correct') : t('grammar.notQuite')}</div>
      <div class="row result-row">
        <p class="full" lang="de"><Highlighted text={sentence} {...marksOf(exercise)} /></p>
        <SpeakButton text={sentence} size={18} />
      </div>
      {#if exercise.relative}
        {@const rel = exercise.relative}
        <!-- Why this pronoun: the noun's gender and the case in the clause. Taught terms, German. -->
        <div class="small why" lang="de">{rel.noun} → {GENDER_NAMES[rel.gender]} · {CASE_NAMES[rel.case]}</div>
      {/if}
      {#if !correct && note}<NoteHint notes={note} />{/if}
    </div>
    <button type="button" class="btn btn-primary btn-lg btn-block" onclick={onnext}>{t('common.continue')}</button>
  {/if}
</div>

<style>
  .prompt {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 28px 18px;
    border-radius: var(--radius-lg);
    background: var(--grad-feature);
    text-align: center;
  }
  .sentence {
    margin: 0;
    font-family: var(--font-display);
    font-size: 22px;
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
  .options {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  .option {
    position: relative;
    min-width: 0;
    min-height: 64px;
    padding: 8px 12px;
    border: 0;
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: inset 0 0 0 1.5px var(--border);
    color: var(--text);
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 800;
    overflow-wrap: anywhere;
    cursor: pointer;
    transition:
      opacity 0.22s ease,
      box-shadow 0.22s ease,
      transform 0.12s ease;
  }
  /* An odd one out takes the whole last row. */
  .option:last-child:nth-child(odd) {
    grid-column: 1 / -1;
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
    display: flex;
    flex-direction: column;
    gap: 6px;
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
  .why {
    color: var(--text-2);
  }
  .result-row {
    justify-content: space-between;
    align-items: flex-start;
  }
  .full {
    margin: 0;
    min-width: 0;
    font-size: 17px;
    line-height: 1.5;
    overflow-wrap: break-word;
  }
</style>
