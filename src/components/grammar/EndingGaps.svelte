<script lang="ts">
  import { ENDING_TOPICS } from '../../lib/grammar/content';
  import { checkEnding, endingMarks, fullSentence, gapOptions } from '../../lib/grammar/practice';
  import type { EndingExercise } from '../../lib/grammar/types';
  import { i18n, t } from '../../lib/i18n.svelte';
  import { settings } from '../../lib/settings.svelte';
  import { speak } from '../../lib/speech/tts';
  import { feedbackFx } from '../../lib/study/fx';
  import NoteHint from '../study/NoteHint.svelte';
  import ResultIcon from '../study/ResultIcon.svelte';
  import SpeakButton from '../SpeakButton.svelte';
  import EndingText from './EndingText.svelte';
  import NounText from './NounText.svelte';

  /**
   * Tap the endings into the gaps of a noun phrase, then check: one try. Keyed per question by the
   * parent. The chips belong to the active gap; a filled gap can be tapped to change it until checked.
   */
  let {
    exercise,
    onanswer,
    onnext,
  }: { exercise: EndingExercise; onanswer: (ok: boolean) => void; onnext: () => void } = $props();

  /** The text between the gaps and the gaps themselves, in order. */
  const parts = $derived(
    exercise.text.split(/(\{\d+\})/).flatMap((piece): ({ text: string } | { gap: number })[] => {
      const m = /^\{(\d+)\}$/.exec(piece);
      if (m && exercise.gaps[Number(m[1])]) return [{ gap: Number(m[1]) }];
      return piece ? [{ text: piece }] : [];
    }),
  );

  let picked = $state<(string | null)[]>([]);
  let active = $state(0);
  let correct = $state<boolean | null>(null);

  const checked = $derived(correct !== null);
  const complete = $derived(exercise.gaps.every((_, i) => picked[i] != null));
  const options = $derived(gapOptions(exercise, active));
  const sentence = $derived(fullSentence(exercise));
  const marks = $derived(endingMarks(exercise));
  const pattern = $derived(ENDING_TOPICS.flatMap((topic) => topic.patterns).find((p) => p.id === exercise.connector));
  const note = $derived(pattern ? [pattern.rule[i18n.lang], pattern.note?.[i18n.lang]].filter(Boolean).join('\n') : '');

  /** How an ending reads on a chip or in a slot: "-en", and "—" for none. */
  const shown = (ending: string) => (ending ? `-${ending}` : '—');

  function choose(ending: string) {
    if (checked) return;
    picked[active] = ending;
    // On to the next empty gap after this one, else the first empty one; stay when all are filled.
    const n = exercise.gaps.length;
    for (let step = 1; step < n; step++) {
      const i = (active + step) % n;
      if (picked[i] == null) {
        active = i;
        return;
      }
    }
  }

  function check() {
    if (checked || !complete) return;
    const ok = checkEnding(exercise, picked);
    correct = ok;
    onanswer(ok);
    if (settings.autoplay) speak(sentence);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.repeat) return;
    if (checked) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onnext();
      }
      return;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= options.length) choose(options[n - 1]);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const len = exercise.gaps.length;
      active = (active + (e.key === 'ArrowRight' ? 1 : len - 1)) % len;
    } else if (e.key === 'Enter' && complete) {
      e.preventDefault();
      check();
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="stack">
  <div class="card prompt" {@attach feedbackFx(correct === null ? null : correct ? 'good' : 'bad')}>
    <div class="muted small">{t('grammar.ending.prompt')}</div>
    <p class="sentence" lang="de">
      {#each parts as part, i}{#if 'text' in part}<NounText text={part.text} start={i === 0} />{:else}{@const gap = exercise.gaps[part.gap]}{@const mine = picked[part.gap]}{#if checked}<span
              class="word"
              >{gap.stem}{#if mine === gap.answer}<span class="end ok">{gap.answer}</span>{:else}<s class="end no"
                  aria-hidden="true">{mine || '—'}</s
                ><span class="end ok">{gap.answer || '—'}</span>{/if}</span
            >{:else}<button
              type="button"
              class="gap"
              class:active={part.gap === active}
              aria-pressed={part.gap === active}
              aria-label={mine == null ? t('grammar.ending.choose', { word: gap.stem }) : gap.stem + mine}
              onclick={() => (active = part.gap)}
              >{gap.stem}<span class="slot" class:empty={mine == null} class:none={mine === ''}
                >{#if mine == null}&nbsp;{:else if mine === ''}—{:else}<span class="anim-pop">{mine}</span>{/if}</span
              ></button
            >{/if}{/if}{/each}
    </p>
    {#if checked}<div class="muted tr">{exercise.tr[settings.lang]}</div>{/if}
  </div>

  {#if !checked}
    <div class="options" role="group" aria-label={t('grammar.ending.options')}>
      {#each options as ending, i (ending)}
        <button
          type="button"
          class="option"
          class:chosen={picked[active] === ending}
          lang={ending ? 'de' : i18n.lang}
          aria-label={ending ? undefined : t('grammar.ending.none')}
          onclick={() => choose(ending)}
        >
          <span class="key" aria-hidden="true">{i + 1}</span>{shown(ending)}
        </button>
      {/each}
    </div>
    <button type="button" class="btn btn-primary btn-lg btn-block" disabled={!complete} onclick={check}>{t('study.check')}</button>
  {:else}
    <div class="card feedback" class:ok={correct} class:no={!correct} role="status">
      <div class="head row"><ResultIcon ok={!!correct} />{correct ? t('study.correct') : t('grammar.notQuite')}</div>
      <div class="row result-row">
        <p class="full" lang="de"><EndingText text={sentence} {marks} nouns /></p>
        <SpeakButton text={sentence} size={18} />
      </div>
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
    padding: 24px 14px;
    border-radius: var(--radius-lg);
    background: var(--grad-feature);
    text-align: center;
  }
  .sentence {
    margin: 0;
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 800;
    line-height: 1.9;
    overflow-wrap: break-word;
  }
  /* A gap is the word's stem and a slot for its ending, one tap target of at least 44px. */
  .gap {
    display: inline-flex;
    align-items: baseline;
    min-height: 44px;
    margin: 0 -2px;
    padding: 4px 2px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    line-height: 1.35;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-user-select: none;
    user-select: none;
    vertical-align: baseline;
  }
  .slot {
    display: inline-block;
    min-width: 1.5em;
    padding: 0 3px;
    border-bottom: 3px solid var(--border);
    color: var(--accent);
    text-align: left;
    transition:
      border-color 0.18s ease,
      background-color 0.18s ease;
  }
  .slot.none {
    color: var(--muted);
    text-align: center;
  }
  .gap.active .slot {
    border-radius: 5px 5px 0 0;
    border-bottom-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .gap:active .slot {
    background: color-mix(in srgb, var(--accent) 26%, transparent);
  }
  @media (prefers-reduced-motion: reduce) {
    .slot {
      transition: none;
    }
  }
  .end.ok {
    color: var(--good);
  }
  /* A pill of its own, so the struck ending doesn't read as part of the word ("neu e en"). */
  .end.no {
    margin: 0 3px 0 2px;
    padding: 0 4px;
    border-radius: 5px;
    background: color-mix(in srgb, var(--bad) 18%, transparent);
    color: var(--bad);
    text-decoration-thickness: 2px;
  }
  .tr {
    overflow-wrap: break-word;
  }
  .options {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  .option {
    position: relative;
    min-width: 0;
    min-height: 56px;
    padding: 8px;
    border: 0;
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: inset 0 0 0 1.5px var(--border);
    color: var(--text);
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 800;
    cursor: pointer;
    touch-action: manipulation;
    transition:
      box-shadow 0.18s ease,
      transform 0.12s ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .option {
      transition: none;
    }
  }
  .option:active {
    opacity: 0.75;
    transform: scale(0.97);
  }
  .option.chosen {
    box-shadow: inset 0 0 0 2.5px var(--accent);
    color: var(--accent);
  }
  .key {
    position: absolute;
    top: 6px;
    left: 9px;
    font-size: 11px;
    font-weight: 700;
    color: var(--muted);
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
