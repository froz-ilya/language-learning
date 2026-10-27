<script lang="ts">
  import type { Grade } from 'ts-fsrs';
  import Icon from '../components/Icon.svelte';
  import Articles from '../components/study/Articles.svelte';
  import Choice from '../components/study/Choice.svelte';
  import Flashcards from '../components/study/Flashcards.svelte';
  import Listen from '../components/study/Listen.svelte';
  import Match from '../components/study/Match.svelte';
  import SessionBar from '../components/study/SessionBar.svelte';
  import SessionResults from '../components/study/SessionResults.svelte';
  import Verbs from '../components/study/Verbs.svelte';
  import Write from '../components/study/Write.svelte';
  import { back, replace, route } from '../lib/router.svelte';
  import { settings } from '../lib/settings.svelte';
  import { stopSpeaking } from '../lib/speech/tts';
  import { recordAnswer, recordMistake } from '../lib/srs/fsrs';
  import { slideIn, slideOut } from '../lib/study/fx';
  import { distractorPool, loadReviews } from '../lib/study/load';
  import { MODE_INFO } from '../lib/study/modes';
  import {
    filterByScope,
    isDirection,
    isStudyMode,
    modeApplies,
    Session,
    type Scope,
    type StudyItem,
    type StudyMode,
  } from '../lib/study/session';
  import { cardsForSource, type SourceKind } from '../lib/study/sources';
  import type { Card, Direction } from '../lib/types';

  // Route: #/study/<kind>/<id>/<mode>?scope=due|all&dir=de-x|x-de|mixed (constant: remounted on navigation).
  const kind = route.parts[1] as SourceKind;
  const sourceId = route.parts[2] ?? '';
  const modeParam = route.parts[3];
  const mode: StudyMode = isStudyMode(modeParam) ? modeParam : 'flashcards';
  const scope: Scope = route.query.get('scope') === 'all' ? 'all' : 'due';
  const dirParam = route.query.get('dir');
  const direction: Direction = isDirection(dirParam) ? dirParam : settings.direction;
  const modesPath = `/modes/${kind}/${sourceId}`;
  const info = MODE_INFO[mode];

  type Phase = 'loading' | 'empty' | 'running' | 'results';
  let phase = $state<Phase>('loading');
  let emptyReason = $state<'nothing-due' | 'no-cards' | 'mode'>('no-cards');

  let pool = $state.raw<Card[]>([]);
  let session: Session | null = null;
  let item = $state.raw<StudyItem | undefined>();
  let answeredSeq = -1;
  let done = $state(0);
  let total = $state(0);
  /** Repeat-mistakes rounds don't write SRS (the first round already graded those cards). */
  let repeat = $state(false);
  let run = $state(0);
  let matchCards = $state.raw<Card[]>([]);
  let results = $state.raw<{ total: number; correct: number; missed: Card[] } | null>(null);

  async function load() {
    try {
      const all = await cardsForSource(kind, sourceId, settings.focus);
      const reviews = await loadReviews(all);
      const scoped = filterByScope(all, reviews, scope);
      const cards = scoped.filter((c) => modeApplies(mode, c));
      if (cards.length === 0 || (mode === 'match' && cards.length < 2)) {
        emptyReason = all.length === 0 ? 'no-cards' : scoped.length === 0 ? 'nothing-due' : 'mode';
        phase = 'empty';
        return;
      }
      if (mode === 'choice') pool = await distractorPool(all.filter((c) => modeApplies('choice', c)));
      start(cards);
    } catch (e) {
      console.error(e);
      emptyReason = 'no-cards';
      phase = 'empty';
    }
  }
  load();

  function start(cards: Card[]) {
    run++;
    results = null;
    total = cards.length;
    done = 0;
    if (mode === 'match') {
      matchCards = cards;
      session = null;
    } else {
      session = new Session(cards, { direction });
      answeredSeq = -1;
      item = session.current;
    }
    phase = 'running';
  }

  // Guarded by item.seq: a component that is still sliding out can't answer twice.
  function onanswer(grade: Grade, correct: boolean) {
    const s = session;
    const card = item?.card;
    if (!s || !item || !card || answeredSeq === item.seq) return;
    answeredSeq = item.seq;
    const { first } = s.answer(correct);
    if (first && !repeat && card.id != null) recordAnswer(card.id, grade).catch(console.error);
    done = s.doneCount;
  }

  function onnext() {
    const s = session;
    if (!s || !item || answeredSeq !== item.seq) return;
    if (s.finished) {
      finish({ total: s.total, correct: s.firstTryCorrect, missed: s.missed });
    } else {
      item = s.current;
    }
  }

  function finish(r: { total: number; correct: number; missed: Card[] }) {
    stopSpeaking();
    results = r;
    item = undefined;
    phase = 'results';
  }

  function onmistake(card: Card) {
    if (!repeat && card.id != null) recordMistake(card.id).catch(console.error);
  }

  function repeatMistakes() {
    if (!results?.missed.length) return;
    repeat = true;
    start(results.missed);
  }

  function close() {
    stopSpeaking();
    back(modesPath);
  }

  function studyAll() {
    replace(`/study/${kind}/${sourceId}/${mode}?scope=all&dir=${direction}`);
  }

  /** Typed modes stay mounted between questions so the iOS keyboard stays up. */
  const stageKey = $derived(
    !item ? `${run}` : mode === 'write' || mode === 'listen' || mode === 'verbs' ? `${run}` : `${run}-${item.seq}`,
  );
</script>

<div class="page study">
  <SessionBar
    title={`${info.name}${repeat ? ' · mistakes' : ''}`}
    count={phase === 'running' ? `${done} / ${total}` : ''}
    ratio={phase === 'running' ? (total ? done / total : 0) : null}
    onclose={close}
  />

  {#if phase === 'loading'}
    <div class="empty">Loading…</div>
  {:else if phase === 'empty'}
    <div class="empty stack">
      {#if emptyReason === 'nothing-due'}
        <div class="big-msg">Nothing due</div>
        <div>You're done for today. Study all words instead?</div>
        <button class="btn btn-primary btn-lg btn-block" onclick={studyAll}>Study all</button>
      {:else if emptyReason === 'mode'}
        <div class="big-msg">No suitable words</div>
        <div>None of these words work for {info.name.toLowerCase()}{mode === 'match' ? ' (needs at least 2)' : ''}.</div>
      {:else}
        <div class="big-msg">No words yet</div>
      {/if}
      <button class="btn btn-block" onclick={close}>Back</button>
    </div>
  {:else if phase === 'running'}
    <div class="stage">
      {#if mode === 'match'}
        {#key run}
          <Match cards={matchCards} {onmistake} onprogress={(n) => (done = n)} onfinish={(missed) => finish({ total, correct: total - missed.length, missed })} />
        {/key}
      {:else if item}
        {#key stageKey}
          <div class="slide" in:slideIn out:slideOut>
            {#if mode === 'flashcards'}
              <Flashcards {item} {onanswer} {onnext} />
            {:else if mode === 'write'}
              <Write {item} {onanswer} {onnext} />
            {:else if mode === 'listen'}
              <Listen {item} {onanswer} {onnext} />
            {:else if mode === 'verbs'}
              <Verbs {item} {onanswer} {onnext} />
            {:else if mode === 'choice'}
              <Choice {item} {pool} {onanswer} {onnext} />
            {:else if mode === 'articles'}
              <Articles {item} {onanswer} {onnext} />
            {/if}
          </div>
        {/key}
      {/if}
    </div>
  {:else if phase === 'results' && results}
    <SessionResults correct={results.correct} total={results.total} missed={results.missed} celebrate={!repeat}>
      {#snippet actions()}
        {#if results?.missed.length}
          <button class="btn btn-primary btn-lg btn-block" onclick={repeatMistakes}>
            <Icon name="refresh" /> Repeat mistakes
          </button>
          <button class="btn btn-lg btn-block" onclick={close}>Done</button>
        {:else}
          <button class="btn btn-primary btn-lg btn-block" onclick={close}>Done</button>
        {/if}
      {/snippet}
    </SessionResults>
  {/if}
</div>

<style>
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
    font-size: 22px;
    font-weight: 700;
    color: var(--text);
  }
</style>
