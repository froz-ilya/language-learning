<script lang="ts">
  import { checkGerman, checkTranslation, type GermanCheck } from '../../lib/german/answer';
  import { speakableTerm } from '../../lib/german/articles';
  import { settings } from '../../lib/settings.svelte';
  import { speak } from '../../lib/speech/tts';
  import { gradeForVerdict, Rating } from '../../lib/srs/fsrs';
  import type { ModeProps } from '../../lib/study/modes';
  import UmlautBar from '../UmlautBar.svelte';
  import Feedback from './Feedback.svelte';

  /**
   * Input + check + feedback + continue, shared by Write and Listen. The component stays
   * mounted across questions (it resets on item.seq) so the input keeps focus and the iOS
   * keyboard stays open.
   */
  let {
    item,
    onanswer,
    onnext,
    answerGerman,
    requireArticle = settings.requireArticle,
    speakAfter = false,
    showTranslation = false,
  }: ModeProps & {
    answerGerman: boolean;
    requireArticle?: boolean;
    /** Pronounce the German word after checking. */
    speakAfter?: boolean;
    showTranslation?: boolean;
  } = $props();

  let input = $state<HTMLInputElement>();
  let value = $state('');
  let result = $state<GermanCheck | null>(null);
  let given = $state('');

  let shownSeq = -1;
  $effect.pre(() => {
    if (item.seq !== shownSeq) {
      shownSeq = item.seq;
      value = '';
      given = '';
      result = null;
    }
  });

  function check() {
    const card = item.card;
    const r: GermanCheck = answerGerman
      ? checkGerman(value, card, settings.strictness, requireArticle)
      : { verdict: checkTranslation(value, card.translation, settings.strictness) };
    given = value;
    result = r;
    onanswer(gradeForVerdict(r.verdict), r.verdict !== 'wrong');
    if (speakAfter) speak(speakableTerm(card));
  }

  function dontKnow() {
    given = '';
    result = { verdict: 'wrong' };
    onanswer(Rating.Again, false);
    if (speakAfter) speak(speakableTerm(item.card));
    input?.focus();
  }

  function next() {
    // Focus inside the tap/Enter handler keeps the iOS keyboard up for the next question.
    input?.focus();
    onnext();
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (result) next();
    else if (value.trim()) check();
  }
</script>

<form class="stack" onsubmit={submit}>
  <input
    bind:this={input}
    bind:value
    class="input answer-input"
    class:locked={!!result}
    readonly={!!result}
    placeholder={answerGerman ? 'Auf Deutsch…' : `In ${settings.lang === 'ru' ? 'Russian' : 'English'}…`}
    lang={answerGerman ? 'de' : settings.lang}
    autocapitalize="off"
    autocomplete="off"
    autocorrect="off"
    spellcheck="false"
    enterkeyhint={result ? 'next' : 'done'}
  />
  {#if answerGerman && !result}
    <UmlautBar {input} oninsert={(v) => (value = v)} />
  {/if}

  {#if result}
    <Feedback
      verdict={result.verdict}
      articleProblem={result.articleProblem}
      card={item.card}
      {answerGerman}
      {given}
      {showTranslation}
    />
    <button type="submit" class="btn btn-primary btn-lg btn-block">Continue</button>
  {:else}
    <button type="submit" class="btn btn-primary btn-lg btn-block" disabled={!value.trim()}>Check</button>
    <button type="button" class="btn btn-ghost btn-block" onclick={dontKnow}>I don't know</button>
  {/if}
</form>

<style>
  .answer-input {
    font-size: 20px;
    min-height: 54px;
  }
  .locked {
    opacity: 0.7;
  }
</style>
