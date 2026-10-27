<script lang="ts">
  import type { Card } from '../../lib/types';
  import type { Verdict } from '../../lib/german/answer';
  import { feedbackFx } from '../../lib/study/fx';
  import ResultIcon from './ResultIcon.svelte';
  import { displayTerm, speakableTerm } from '../../lib/german/articles';
  import Term from '../Term.svelte';
  import SpeakButton from '../SpeakButton.svelte';

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
</div>

<style>
  .feedback {
    border-radius: var(--radius);
    padding: 12px 16px;
    border: 2px solid var(--border);
    background: var(--surface);
  }
  .feedback.correct {
    border-color: var(--good);
  }
  .feedback.typo {
    border-color: var(--warn);
  }
  .feedback.wrong {
    border-color: var(--bad);
  }
  .head {
    font-weight: 700;
  }
  .correct .head {
    color: var(--good);
  }
  .typo .head {
    color: var(--warn);
  }
  .wrong .head {
    color: var(--bad);
  }
  .answer-row {
    margin-top: 4px;
    justify-content: space-between;
  }
  .big {
    font-size: 22px;
    font-weight: 600;
  }
</style>
