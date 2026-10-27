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
  .intro p {
    margin: 0 0 12px;
    color: var(--muted);
    font-size: 15px;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .meta {
    display: flex;
    gap: 12px;
    margin-top: 2px;
    font-size: 13px;
  }
  .misses {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--warn);
    font-weight: 600;
  }
  .hook {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
</style>
