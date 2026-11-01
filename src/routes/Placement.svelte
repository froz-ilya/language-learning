<script lang="ts">
  import Header from '../components/Header.svelte';
  import PlacementCard from '../components/study/PlacementCard.svelte';
  import SessionBar from '../components/study/SessionBar.svelte';
  import Confetti from '../components/study/Confetti.svelte';
  import { fly } from 'svelte/transition';
  import { cardsInFolder, levelFolder } from '../lib/db/repo';
  import { t, tn } from '../lib/i18n.svelte';
  import { dur } from '../lib/motion';
  import { setKnown } from '../lib/progress';
  import { back, go, route } from '../lib/router.svelte';
  import { stopSpeaking } from '../lib/speech/tts';
  import { slideIn, slideOut } from '../lib/study/fx';
  import { loadReviews } from '../lib/study/load';
  import { placementPassed, placementSample, PLACEMENT_PASS } from '../lib/study/placement';
  import { confirmAction, showToast } from '../lib/ui/dialogs.svelte';
  import type { Card } from '../lib/types';

  // Route: #/placement/<code> — quick check of how much of a level you already know.
  const code = route.parts[1] ?? '';
  const levelPath = `/level/${code}`;

  type Phase = 'loading' | 'missing' | 'empty' | 'running' | 'done';
  let phase = $state<Phase>('loading');
  let sample = $state.raw<Card[]>([]);
  let index = $state(0);
  let knew = $state.raw<Card[]>([]);
  /** Level words never studied and not yet known: what "Mark whole level" marks. */
  let unstudied = $state.raw<number[]>([]);
  let busy = $state(false);

  async function load() {
    try {
      const folder = await levelFolder(code);
      if (!folder) {
        phase = 'missing';
        return;
      }
      const cards = await cardsInFolder(folder.id!);
      const reviews = await loadReviews(cards);
      unstudied = cards.filter((c) => c.id != null && !c.known && !reviews.has(c.id)).map((c) => c.id!);
      sample = placementSample(cards);
      phase = sample.length ? 'running' : 'empty';
    } catch (e) {
      console.error(e);
      phase = 'empty';
    }
  }
  load();

  const current = $derived(sample[index]);
  const passed = $derived(placementPassed(knew.length, sample.length));

  function onanswer(knows: boolean) {
    const card = current;
    if (!card) return;
    if (knows) knew = [...knew, card];
    if (index + 1 >= sample.length) {
      stopSpeaking();
      phase = 'done';
    }
    index++;
  }

  async function markAll() {
    if (busy) return;
    const ok = await confirmAction({
      title: t('placement.markTitle', { code }),
      message: t('placement.markMessage', { n: unstudied.length }),
      confirmLabel: t('library.markKnown'),
    });
    if (!ok) return;
    await mark(unstudied, tn('placement.marked', unstudied.length));
  }

  async function markKnew() {
    if (busy) return;
    const ids = knew.map((c) => c.id).filter((id): id is number => id != null);
    await mark(ids, tn('placement.marked', ids.length));
  }

  async function mark(ids: number[], message: string) {
    busy = true;
    try {
      if (ids.length) await setKnown(ids, true);
      showToast(message);
      finish();
    } catch (e) {
      console.error(e);
      showToast(t('placement.saveFailed'));
    } finally {
      busy = false;
    }
  }

  function finish() {
    stopSpeaking();
    back(levelPath);
  }
</script>

{#if phase === 'missing'}
  <div class="page">
    <Header title={t('placement.title')} subtitle={t('common.level', { code })} backTo={levelPath} />
    <div class="empty stack">
      <div class="big-msg">{t('placement.installFirst', { code })}</div>
      <div>{t('placement.installFirstText')}</div>
      <button class="btn btn-primary btn-lg btn-block" onclick={() => go(levelPath)}>{t('placement.goToLevel', { code })}</button>
    </div>
  </div>
{:else}
  <div class="page placement">
    <SessionBar
      title={t('placement.sessionTitle', { code })}
      count={phase === 'running' ? `${Math.min(index + 1, sample.length)} / ${sample.length}` : ''}
      ratio={phase === 'running' ? index / Math.max(1, sample.length) : null}
      onclose={finish}
    />

    {#if phase === 'loading'}
      <div class="empty">{t('common.loading')}</div>
    {:else if phase === 'empty'}
      <div class="empty stack">
        <div class="big-msg">{t('placement.noWords')}</div>
        <button class="btn btn-block" onclick={finish}>{t('common.back')}</button>
      </div>
    {:else if phase === 'running' && current}
      <p class="muted small center intro">{t('placement.intro')}</p>
      <div class="stage">
        {#key index}
          <div class="slide" in:slideIn out:slideOut>
            <PlacementCard card={current} {onanswer} />
          </div>
        {/key}
      </div>
    {:else if phase === 'done'}
      {#if passed}<Confetti />{/if}
      <div class="stack result" in:fly={{ y: 16, duration: dur(280) }}>
        <div class="card score">
          <div class="score-num" class:good={passed}>{knew.length} / {sample.length}</div>
          <div class="muted">{t('placement.scoreLabel')}</div>
        </div>

        {#if passed}
          <p class="center">
            {t('placement.passed', { code })}
          </p>
          <button class="btn btn-primary btn-lg btn-block" disabled={busy || !unstudied.length} onclick={markAll}>
            {t('library.markLevelKnown')}
          </button>
          <button class="btn btn-lg btn-block" disabled={busy} onclick={markKnew}>{t('placement.onlyKnew')}</button>
        {:else}
          <p class="center">
            {t('placement.failed', { code, pct: Math.round(PLACEMENT_PASS * 100) })}
          </p>
          <button class="btn btn-primary btn-lg btn-block" disabled={busy || !knew.length} onclick={markKnew}>
            {t('placement.markKnew')}
          </button>
          <button class="btn btn-lg btn-block" onclick={() => go(`/learn/level/${code}`)}>{t('placement.startLearning', { code })}</button>
        {/if}
        <button class="btn btn-ghost btn-block" onclick={finish}>{t('placement.notNow')}</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .intro {
    margin: 0 0 12px;
  }
  .stage {
    display: grid;
    margin: 0 -16px;
    padding: 0 16px 8px;
    overflow-x: clip;
  }
  .slide {
    grid-area: 1 / 1;
    min-width: 0;
  }
  .big-msg {
    font-family: var(--font-display);
    font-size: 24px;
    font-weight: 900;
    color: var(--text);
  }
  .score {
    text-align: center;
    padding: 28px 16px;
    border-radius: var(--radius-lg);
    background: var(--grad-feature);
  }
  .score-num {
    font-family: var(--font-display);
    font-size: 60px;
    font-weight: 900;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  .result p {
    margin: 4px 8px;
  }
</style>
