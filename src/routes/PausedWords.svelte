<script lang="ts">
  import { slide } from 'svelte/transition';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Term from '../components/Term.svelte';
  import EmptyState from '../components/library/EmptyState.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { stagger } from '../components/library/actions';
  import { locale, t, tn } from '../lib/i18n.svelte';
  import { live } from '../lib/live.svelte';
  import { dur, enter } from '../lib/motion';
  import { setPaused } from '../lib/progress';
  import { pausedCards } from '../lib/study/sources';
  import { showToast } from '../lib/ui/dialogs.svelte';
  import type { Card } from '../lib/types';

  /** Words put on pause ("Not now"): bring them back one by one or all at once. */
  const paused = live(() => pausedCards());

  const since = (c: Card) => new Date(c.paused!).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });

  async function resume(c: Card) {
    await setPaused([c.id!], false);
    showToast(t('paused.resumed', { term: c.term }), {
      actionLabel: t('common.undo'),
      onAction: () => void setPaused([c.id!], true, c.paused),
    });
  }

  async function resumeAll() {
    const cards = paused.value ?? [];
    await setPaused(cards.map((c) => c.id!), false);
    showToast(tn('paused.resumedAll', cards.length));
  }
</script>

<div class="page">
  <Header title={t('paused.title')} backTo="/" />

  {#if !paused.value}
    <div class="card"><Skeleton lines={4} /></div>
  {:else if !paused.value.length}
    <EmptyState icon="pause" title={t('paused.emptyTitle')} text={t('paused.emptyText')} />
  {:else}
    <div class="stack">
      <div class="card intro">
        <p>{t('paused.intro')}</p>
        <button class="btn btn-primary btn-lg btn-block" onclick={resumeAll}>
          <Icon name="play" filled size={18} /> {tn('paused.resumeAll', paused.value.length)}
        </button>
      </div>

      <div class="list">
        {#each paused.value as c, i (c.id)}
          <div class="list-item" in:enter|global={{ y: 8, duration: dur(200), delay: stagger(i) }} out:slide={{ duration: dur(200) }}>
            <a class="grow" href="#/card/{c.id}">
              <div class="title"><Term card={c} /></div>
              {#if c.translation}<div class="sub">{c.translation}</div>{/if}
              <div class="meta small muted">{t('paused.since', { date: since(c) })}</div>
            </a>
            <button class="btn small-btn" onclick={() => resume(c)}>{t('paused.resume')}</button>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .intro {
    border-radius: var(--radius-lg);
    background: var(--grad-feature);
  }
  .intro p {
    margin: 0 0 16px;
    color: var(--text-2);
    font-size: 15px;
    line-height: 1.5;
  }
  .list-item :global(.title) {
    font-family: var(--font-display);
    font-weight: 800;
  }
  .grow {
    flex: 1;
    min-width: 0;
    color: inherit;
    text-decoration: none;
  }
  .meta {
    margin-top: 4px;
  }
  .small-btn {
    flex-shrink: 0;
    min-height: 38px;
    padding: 6px 12px;
    font-size: 15px;
  }
</style>
