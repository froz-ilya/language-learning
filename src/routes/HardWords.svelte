<script lang="ts">
  import { fly } from 'svelte/transition';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Term from '../components/Term.svelte';
  import SpeakButton from '../components/SpeakButton.svelte';
  import EmptyState from '../components/library/EmptyState.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { stagger } from '../components/library/actions';
  import { go } from '../lib/router.svelte';
  import { live } from '../lib/live.svelte';
  import { dur } from '../lib/motion';
  import { HARD_MISSES } from '../lib/progress';
  import { speakableTerm } from '../lib/german/articles';
  import { hardCards } from '../lib/study/sources';
  import type { Card } from '../lib/types';

  /** Words missed HARD_MISSES+ times that aren't learned yet: practice them, add a memory hook. */
  const hard = live(() => hardCards());

  // Only the user's own note counts: example sentences usually come from the dictionary.
  const hasHook = (c: Card) => !!c.notes.trim();
</script>

<div class="page">
  <Header title="Hard words" backTo="/" />

  {#if !hard.value}
    <div class="card"><Skeleton lines={4} /></div>
  {:else if !hard.value.length}
    <EmptyState
      icon="flame"
      title="No hard words"
      text="Words you miss {HARD_MISSES} or more times show up here, so you can give them extra attention."
    />
  {:else}
    <div class="stack">
      <div class="card intro">
        <span class="flame" aria-hidden="true"><Icon name="flame" size={28} filled /></span>
        <p>
          You keep missing these words. A <strong>memory hook</strong> helps: a note with a mnemonic or a similar
          Russian word, or your own example sentence. Your note is shown when you study the word.
        </p>
        <button class="btn btn-primary btn-lg btn-block" onclick={() => go('/learn/smart/hard')}>
          <Icon name="play" filled size={18} /> Practice {hard.value.length}
          {hard.value.length === 1 ? 'word' : 'words'}
        </button>
      </div>

      <div class="list">
        {#each hard.value as { card, review }, i (card.id)}
          <a class="list-item" href="#/card/{card.id}" in:fly|global={{ y: 8, duration: dur(200), delay: stagger(i) }}>
            <div class="grow">
              <div class="title"><Term {card} /></div>
              <div class="sub">{card.translation}</div>
              <div class="meta">
                <span class="misses"><Icon name="flame" size={14} /> missed {review.mistakes}×</span>
                {#if hasHook(card)}
                  <span class="hook good"><Icon name="check" size={14} /> has a hook</span>
                {:else}
                  <span class="hook muted">add a hook →</span>
                {/if}
              </div>
            </div>
            <SpeakButton text={speakableTerm(card)} />
          </a>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .intro {
    position: relative;
    overflow: hidden;
    isolation: isolate;
    padding: 20px 18px 18px;
    border-radius: var(--radius-lg);
    background: var(--grad-feature);
  }
  /* Warm ember glow behind the flame */
  .intro::before {
    content: '';
    position: absolute;
    z-index: -1;
    top: -90px;
    left: -60px;
    width: 240px;
    height: 240px;
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--warn) 24%, transparent), color-mix(in srgb, var(--warn) 0%, transparent) 68%);
  }
  .flame {
    display: inline-grid;
    place-items: center;
    width: 52px;
    height: 52px;
    margin-bottom: 12px;
    border-radius: 18px;
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 16%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warn) 22%, transparent);
  }
  .intro p {
    margin: 0 0 16px;
    color: var(--text-2);
    font-size: 15px;
    line-height: 1.5;
  }
  .intro strong {
    color: var(--warn);
  }
  .list-item :global(.title) {
    font-family: var(--font-display);
    font-weight: 800;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
    font-size: 12.5px;
  }
  .misses,
  .hook {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 8px 2px 6px;
    border-radius: 999px;
    font-weight: 700;
    background: var(--surface-2);
  }
  .misses {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 13%, transparent);
  }
  .hook.good {
    background: color-mix(in srgb, var(--good) 13%, transparent);
  }
</style>
