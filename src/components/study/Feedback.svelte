<script lang="ts">
  import type { Card } from '../../lib/types';
  import type { Verdict } from '../../lib/german/answer';
  import { feedbackFx } from '../../lib/study/fx';
  import ResultIcon from './ResultIcon.svelte';
  import { displayTerm, speakableTerm } from '../../lib/german/articles';
  import Term from '../Term.svelte';
  import SpeakButton from '../SpeakButton.svelte';
  import NoteHint from './NoteHint.svelte';

  /** Result panel for typed answers (Write, Listen). */
  let {
    verdict,
    articleProblem,
    card,
    answerGerman,
    given = '',
    showTranslation = false,
  }: {
    verdict: Verdict;
    articleProblem?: 'missing' | 'wrong';
    card: Card;
    answerGerman: boolean;
    given?: string;
    /** Also show the translation under the German answer (Listen). */
    showTranslation?: boolean;
  } = $props();

  const expected = $derived(answerGerman ? displayTerm(card) : card.translation);
</script>

<div class="feedback {verdict}" role="status" {@attach feedbackFx(verdict === 'wrong' ? 'bad' : 'good')}>
  <div class="head row">
    <ResultIcon ok={verdict !== 'wrong'} />
    <span>
      {#if verdict === 'correct'}
        Correct!
      {:else if verdict === 'typo'}
        Accepted — check spelling: <span class="answer">{expected}</span>
      {:else if articleProblem === 'missing'}
        Missing article
      {:else if articleProblem === 'wrong'}
        Wrong article
      {:else}
        {given.trim() ? 'Not quite' : 'The answer is'}
      {/if}
    </span>
  </div>

  <div class="row answer-row">
    <div class="answer big">
      {#if answerGerman}<Term {card} />{:else}{card.translation}{/if}
    </div>
    {#if answerGerman}<SpeakButton text={speakableTerm(card)} />{/if}
  </div>
  {#if showTranslation || (!answerGerman && verdict !== 'correct')}
    <div class="muted small">
      {#if answerGerman}{card.translation}{:else}<Term {card} />{/if}
    </div>
  {/if}
  {#if verdict === 'wrong' && given.trim()}
    <div class="small muted">You wrote: <s>{given}</s></div>
  {/if}
  {#if verdict !== 'correct'}<NoteHint notes={card.notes} />{/if}
</div>

<style>
  .feedback {
    --tone: var(--border);
    border-radius: var(--radius);
    padding: 14px 16px;
    background: color-mix(in srgb, var(--tone) 10%, var(--surface));
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--tone) 55%, transparent);
    overflow-wrap: break-word;
  }
  .feedback.correct {
    --tone: var(--good);
  }
  .feedback.typo {
    --tone: var(--warn);
  }
  .feedback.wrong {
    --tone: var(--bad);
  }
  .head {
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 800;
    color: var(--tone);
    align-items: flex-start;
  }
  .answer-row {
    margin-top: 4px;
    justify-content: space-between;
  }
  .big {
    min-width: 0;
    font-family: var(--font-display);
    font-size: 24px;
    font-weight: 800;
    line-height: 1.2;
  }
</style>
