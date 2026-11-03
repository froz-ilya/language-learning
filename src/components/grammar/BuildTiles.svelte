<script lang="ts">
  import { untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import { fullSentence, checkBuild, marksOf, modelAnswer, shuffledTiles, tilesOf } from '../../lib/grammar/practice';
  import type { BuildExercise } from '../../lib/grammar/types';
  import { t } from '../../lib/i18n.svelte';
  import { dur } from '../../lib/motion';
  import { settings } from '../../lib/settings.svelte';
  import { speak } from '../../lib/speech/tts';
  import { feedbackFx } from '../../lib/study/fx';
  import ResultIcon from '../study/ResultIcon.svelte';
  import SpeakButton from '../SpeakButton.svelte';
  import Highlighted from './Highlighted.svelte';

  /** Tap the shuffled words into order, one try. Keyed per question by the parent. */
  let {
    exercise,
    onanswer,
    onnext,
  }: { exercise: BuildExercise; onanswer: (ok: boolean) => void; onnext: () => void } = $props();

  /** Tiles are told apart by index: a sentence can repeat a word. */
  const tiles = untrack(() => shuffledTiles(exercise));
  const target = $derived(tilesOf(exercise));

  let placed = $state<number[]>([]);
  let correct = $state<boolean | null>(null);
  /** Kept while the tray is hidden by the feedback, so the answer area holds its size. */
  let trayHeight = $state(0);

  const checked = $derived(correct !== null);
  const picked = $derived(placed.map((i) => tiles[i]));
  const complete = $derived(placed.length === tiles.length);
  const sentence = $derived(modelAnswer(exercise, picked));
  const model = $derived(fullSentence(exercise));

  const same = (a: string | undefined, b: string | undefined) => a?.toLocaleLowerCase('de') === b?.toLocaleLowerCase('de');

  function place(i: number) {
    if (!checked) placed.push(i);
  }

  function unplace(i: number) {
    if (!checked) placed = placed.filter((p) => p !== i);
  }

  function check() {
    if (checked || !complete) return;
    const ok = checkBuild(exercise, picked);
    correct = ok;
    onanswer(ok);
    if (settings.autoplay) speak(sentence);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.repeat || (e.key !== 'Enter' && !(checked && e.key === ' '))) return;
    if (!checked && !complete) return;
    e.preventDefault();
    if (checked) onnext();
    else check();
  }
</script>

<svelte:window {onkeydown} />

<div class="build">
  <div class="card prompt">
    <div class="muted small">{t('grammar.buildPrompt')}</div>
    <div class="tr">{exercise.tr[settings.lang]}</div>
    {#if exercise.given}<div class="given" lang="de">{exercise.given}</div>{/if}
  </div>

  <div
    class="answer"
    lang="de"
    style:min-height="min({trayHeight + 16}px, 160px)"
    {@attach feedbackFx(correct === null ? null : correct ? 'good' : 'bad')}
  >
    {#each placed as i, pos (i)}
      <button
        type="button"
        class="tile anim-pop"
        class:wrong={correct === false && !same(tiles[i], target[pos])}
        disabled={checked}
        onclick={() => unplace(i)}
        animate:flip={{ duration: dur(160) }}
      >
        {tiles[i]}
      </button>
    {/each}
  </div>

  {#if !checked}
    <div
      class="tray"
      lang="de"
      bind:clientHeight={() => trayHeight, (h) => {
        if (h) trayHeight = h;
      }}
    >
      {#each tiles as word, i (i)}
        {#if placed.includes(i)}
          <span class="tile ghost" aria-hidden="true">{word}</span>
        {:else}
          <button type="button" class="tile" onclick={() => place(i)}>{word}</button>
        {/if}
      {/each}
    </div>
    <button type="button" class="btn btn-primary btn-lg btn-block" disabled={!complete} onclick={check}>{t('study.check')}</button>
  {:else}
    <div class="card feedback" class:ok={correct} class:no={!correct} role="status">
      <div class="head row"><ResultIcon ok={!!correct} />{correct ? t('study.correct') : t('grammar.notQuite')}</div>
      <div class="row result-row">
        <p class="full" lang="de"><Highlighted text={sentence} {...marksOf(exercise)} /></p>
        <SpeakButton text={sentence} size={18} />
      </div>
      {#if correct && sentence !== model}
        <div class="muted small">{t('grammar.alsoPossible')}</div>
        <div class="row result-row">
          <p class="full" lang="de"><Highlighted text={model} {...marksOf(exercise)} /></p>
          <SpeakButton text={model} size={18} />
        </div>
      {/if}
    </div>
    <button type="button" class="btn btn-primary btn-lg btn-block" onclick={onnext}>{t('common.continue')}</button>
  {/if}
</div>

<style>
  .build {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: calc(100dvh - var(--safe-top) - 96px);
  }
  .prompt {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-radius: var(--radius-lg);
    background: var(--grad-feature);
  }
  .tr {
    font-size: 15px;
    color: var(--muted);
    overflow-wrap: break-word;
  }
  .given {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
    line-height: 1.35;
    overflow-wrap: break-word;
  }
  .answer {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 6px;
    padding: 8px;
    border-radius: var(--radius-sm);
    background: var(--inset-bg);
    box-shadow: inset 0 0 0 1.5px var(--border);
  }
  .tray {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin-top: auto;
  }
  .tile {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    max-width: 100%;
    padding: 8px 12px;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--text);
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 800;
    overflow-wrap: anywhere;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-user-select: none;
    user-select: none;
  }
  .tile:disabled {
    color: var(--text);
    cursor: default;
  }
  .tile:not(:disabled):active {
    background: var(--surface-2);
  }
  .tile.wrong {
    color: var(--bad);
    box-shadow: inset 0 0 0 1.5px var(--bad);
  }
  /* Same size as the tile it stands for, so what's left never moves under the thumb. */
  .ghost {
    background: none;
    box-shadow: inset 0 0 0 1.5px var(--border);
    color: transparent;
    cursor: default;
  }
  .feedback {
    --tone: var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: auto;
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
