<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { speakableTerm } from '../../lib/german/articles';
  import { fmtNumber, t, tn } from '../../lib/i18n.svelte';
  import { dur, easeOut } from '../../lib/motion';
  import type { Card } from '../../lib/types';
  import SpeakButton from '../SpeakButton.svelte';
  import Term from '../Term.svelte';
  import Confetti from './Confetti.svelte';
  import Icon from '../Icon.svelte';

  /** End-of-session screen: confetti, count-up score, missed words, action buttons. */
  let {
    correct,
    total,
    missed,
    celebrate = true,
    becameHard = [],
    missedCount,
    missedList,
    actions,
  }: {
    correct: number;
    total: number;
    missed: Card[];
    celebrate?: boolean;
    /** Words that just became hard words (missed 5+ times): nudge to add a memory hook. */
    becameHard?: Card[];
    /** Mistakes that aren't words (grammar): their number, and the list shown instead of `missed`. */
    missedCount?: number;
    missedList?: Snippet;
    actions: Snippet;
  } = $props();

  let shown = $state(0);
  const mistakes = $derived(missedCount ?? missed.length);

  $effect(() => {
    const target = correct;
    const ms = dur(Math.min(1000, 300 + target * 40));
    if (!ms || !target) {
      shown = target;
      return;
    }
    const start = performance.now();
    let raf = requestAnimationFrame(function step(t) {
      const k = Math.min(1, (t - start) / ms);
      shown = Math.round(easeOut(k) * target);
      if (k < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  });

  const perfect = $derived(total > 0 && correct === total);
  const headline = $derived(
    perfect
      ? t('study.results.perfect')
      : total && correct / total >= 0.8
        ? t('study.results.great')
        : total && correct / total >= 0.5
          ? t('study.results.nice')
          : t('study.results.keepPractising'),
  );
</script>

{#if celebrate && total > 0}<Confetti />{/if}

<div class="stack results" in:fly|global={{ y: 16, duration: dur(280) }}>
  <div class="card score">
    <div class="headline">{headline}</div>
    <div class="score-num" class:good={perfect}>
      <span>{fmtNumber(shown)}</span><span class="of"> / {fmtNumber(total)}</span>
    </div>
    <div class="muted">{t('study.results.firstTry')}</div>
  </div>

  {#if becameHard.length}
    <a class="card hard-nudge" href="#/hard" in:fade={{ duration: dur(200) }}>
      <span class="hard-icon"><Icon name="flame" size={22} filled /></span>
      <span class="hard-text">
        <strong>
          {tn('study.results.hardTitle', becameHard.length)}
        </strong>
        <span class="small muted">
          {tn('study.results.hardHint', becameHard.length, { terms: becameHard.map((c) => c.term).join(', ') })}
        </span>
      </span>
      <Icon name="chevron" size={18} />
    </a>
  {/if}

  {#if mistakes}
    <div>
      <div class="section-title">{t('study.results.toReview', { n: mistakes })}</div>
      {#if missedList}
        {@render missedList()}
      {:else}
        <div class="list">
          {#each missed as c, i (c.id ?? i)}
            <div class="list-item">
              <div class="missed-text">
                <div class="title"><Term card={c} /></div>
                <div class="sub">{c.translation}</div>
              </div>
              <SpeakButton text={speakableTerm(c)} />
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {:else if total > 0}
    <div class="center muted">{t('study.results.noMistakes')}</div>
  {/if}

  {@render actions()}
</div>

<style>
  .hard-nudge {
    display: flex;
    align-items: center;
    gap: 12px;
    color: inherit;
    text-decoration: none;
    background: color-mix(in srgb, var(--warn) 8%, var(--surface));
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--warn) 45%, transparent);
  }
  .hard-icon {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 14px;
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 16%, transparent);
    flex-shrink: 0;
  }
  .hard-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .results {
    margin-top: 4px;
  }
  .score {
    position: relative;
    overflow: hidden;
    isolation: isolate;
    text-align: center;
    padding: 30px 16px 26px;
    border-radius: var(--radius-lg);
    background: var(--grad-feature);
  }
  .score::before {
    content: '';
    position: absolute;
    z-index: -1;
    top: -120px;
    left: 50%;
    width: 300px;
    height: 300px;
    transform: translateX(-50%);
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--accent-fill) 22%, transparent), color-mix(in srgb, var(--accent-fill) 0%, transparent) 68%);
  }
  .headline {
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 900;
  }
  .score-num {
    font-family: var(--font-display);
    font-size: 64px;
    font-weight: 900;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    line-height: 1.15;
    margin-top: 6px;
  }
  .of {
    color: var(--muted);
    font-size: 32px;
    font-weight: 800;
  }
  .missed-text {
    flex: 1;
    min-width: 0;
  }
</style>
