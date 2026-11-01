<script lang="ts">
  import type { Card } from '../../lib/types';
  import type { Verdict } from '../../lib/german/answer';
  import { t, tParts } from '../../lib/i18n.svelte';
  import { feedbackFx } from '../../lib/study/fx';
  import ResultIcon from './ResultIcon.svelte';
  import { displayTerm, speakableTerm } from '../../lib/german/articles';
  import { withSich } from '../../lib/german/reflexive';
  import Term from '../Term.svelte';
  import SpeakButton from '../SpeakButton.svelte';
  import Examples from './Examples.svelte';
  import NoteHint from './NoteHint.svelte';
  import Preps from './Preps.svelte';

  /** Result panel for typed answers (Write, Listen). */
  let {
    verdict,
    articleProblem,
    reflexiveProblem,
    card,
    answerGerman,
    given = '',
    showTranslation = false,
  }: {
    verdict: Verdict;
    articleProblem?: 'missing' | 'wrong';
    reflexiveProblem?: 'missing' | 'form';
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
      {#if reflexiveProblem === 'missing' && verdict !== 'wrong'}
        {#each tParts('study.feedback.forgotSich') as p}{#if p.slot}<span class="answer">{withSich(card.term)}</span>{:else}{p.text}{/if}{/each}
      {:else if verdict === 'correct'}
        {t('study.correct')}
      {:else if verdict === 'typo'}
        {#each tParts('study.feedback.typo') as p}{#if p.slot}<span class="answer">{expected}</span>{:else}{p.text}{/if}{/each}
      {:else if articleProblem === 'missing'}
        {t('study.feedback.missingArticle')}
      {:else if articleProblem === 'wrong'}
        {t('study.feedback.wrongArticle')}
      {:else}
        {given.trim() ? t('study.notQuite') : t('study.feedback.theAnswerIs')}
      {/if}
    </span>
  </div>

  <div class="row answer-row">
    <div class="answer big">
      {#if answerGerman}<Term {card} />{:else}{card.translation}{/if}
    </div>
    {#if answerGerman}<SpeakButton text={speakableTerm(card)} />{/if}
  </div>
  {#if reflexiveProblem === 'form' && verdict !== 'wrong'}
    <div class="small muted">{#each tParts('study.feedback.dictionaryForm') as p}{#if p.slot}<span lang="de">{withSich(card.term)}</span>{:else}{p.text}{/if}{/each}</div>
  {/if}
  <Preps preps={card.preps} />
  {#if showTranslation || (!answerGerman && verdict !== 'correct')}
    <div class="muted small">
      {#if answerGerman}{card.translation}{:else}<Term {card} />{/if}
    </div>
  {/if}
  {#if verdict === 'wrong' && given.trim()}
    <div class="small muted">{#each tParts('study.feedback.youWrote') as p}{#if p.slot}<s>{given}</s>{:else}{p.text}{/if}{/each}</div>
  {/if}
  {#if verdict !== 'correct'}<NoteHint notes={card.notes} />{/if}
  <Examples {card} />
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
