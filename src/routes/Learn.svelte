<script lang="ts">
  import type { Grade } from 'ts-fsrs';
  import Articles from '../components/study/Articles.svelte';
  import Choice from '../components/study/Choice.svelte';
  import Flashcards from '../components/study/Flashcards.svelte';
  import Listen from '../components/study/Listen.svelte';
  import SessionBar from '../components/study/SessionBar.svelte';
  import SessionResults from '../components/study/SessionResults.svelte';
  import SmartIntro from '../components/study/SmartIntro.svelte';
  import Verbs from '../components/study/Verbs.svelte';
  import Write from '../components/study/Write.svelte';
  import { back, go, route } from '../lib/router.svelte';
  import { saveSettings, settings } from '../lib/settings.svelte';
  import { isSpeechSupported, stopSpeaking } from '../lib/speech/tts';
  import { recordAnswer } from '../lib/srs/fsrs';
  import { slideIn, slideOut } from '../lib/study/fx';
  import { distractorPool, loadReviews } from '../lib/study/load';
  import { modeApplies } from '../lib/study/session';
  import { planSmartQueue, SmartSession, type SmartItem } from '../lib/study/smart';
  import { cardsForSource, sourceTitle, type SourceKind } from '../lib/study/sources';
  import type { Card, Review } from '../lib/types';
  import { newlyHard } from '../lib/progress';

  // Route: #/learn/<kind>/<id> — the smart session (constant: remounted on navigation).
  const kind = (route.parts[1] ?? 'smart') as SourceKind;
  const sourceId = route.parts[2] ?? 'today';
  const backTo =
    kind === 'set' ? `/set/${sourceId}` : kind === 'folder' ? `/folder/${sourceId}` : kind === 'level' ? `/level/${sourceId}` : '/';
  const modesPath = `/modes/${kind}/${sourceId}`;

  // Learning a set/folder/level makes it the focus: Today continues with its new words.
  if (kind === 'set' || kind === 'folder' || kind === 'level') {
    const focus = `${kind}/${sourceId}`;
    if (settings.focus !== focus) {
      settings.focus = focus;
      saveSettings().catch(console.error);
    }
  }

  type Phase = 'loading' | 'empty' | 'running' | 'results';
  let phase = $state<Phase>('loading');
  let title = $state('');
  let noWords = $state(false);

  let session: SmartSession | null = null;
  let item = $state.raw<SmartItem | undefined>();
  let answeredSeq = -1;
  let progress = $state(0);
  let done = $state(0);
  let total = $state(0);
  let pool = $state.raw<Card[]>([]);
  let results = $state.raw<{ correct: number; total: number; missed: Card[] } | null>(null);
  /** Words that became hard words in this session (nudge on the results screen). */
  let becameHard = $state.raw<Card[]>([]);
  /** Miss counts when the session started, to spot words that just crossed the hard-word line. */
  let missesBefore = new Map<number, number>();
  /** Cards + reviews for "Learn new words anyway" (null: nothing new left). */
  let anyway = $state.raw<{ cards: Card[]; reviews: Map<number, Review> } | null>(null);
  let pending: Promise<unknown>[] = [];

  sourceTitle(kind, sourceId)
    .then((t) => (title = t))
    .catch(() => {});

  const newCount = () => Math.max(5, settings.newPerSession);

  function build(cards: Card[], reviews: Map<number, Review>, newPerSession: number) {
    missesBefore = new Map([...reviews].map(([id, r]) => [id, r.mistakes]));
    return new SmartSession(cards, reviews, {
      newPerSession,
      poolSize: pool.length,
      canListen: isSpeechSupported(),
    });
  }

  async function load() {
    phase = 'loading';
    try {
      await Promise.allSettled(pending);
      pending = [];
      const cards = await cardsForSource(kind, sourceId, settings.focus);
      const reviews = await loadReviews(cards);
      pool = await distractorPool(cards.filter((c) => modeApplies('choice', c)));
      const s = build(cards, reviews, settings.newPerSession);
      if (!s.empty) return begin(s);
      noWords = cards.filter((c) => !c.known).length === 0;
      anyway = await findNewWords(cards, reviews, s);
      phase = 'empty';
    } catch (e) {
      console.error(e);
      noWords = true;
      phase = 'empty';
    }
  }
  load();

  /** Where "Learn new words anyway" takes its words from. */
  async function findNewWords(cards: Card[], reviews: Map<number, Review>, s: SmartSession) {
    if (s.plan.moreNew > 0) return { cards, reviews };
    if (kind !== 'smart') return null;
    // Smart sources (due, starred, …): fall back to the focus source and own new words.
    const extra = [...(await cardsForSource('smart', 'today', settings.focus)), ...(await cardsForSource('smart', 'new'))];
    const extraReviews = await loadReviews(extra);
    const plan = planSmartQueue(extra, extraReviews, { newPerSession: newCount() });
    return plan.fresh.length ? { cards: extra, reviews: extraReviews } : null;
  }

  async function learnAnyway() {
    if (!anyway) return;
    const { cards, reviews } = anyway;
    phase = 'loading';
    pool = await distractorPool(cards.filter((c) => modeApplies('choice', c)));
    begin(build(cards, reviews, newCount()));
  }

  function begin(s: SmartSession) {
    session = s;
    results = null;
    answeredSeq = -1;
    item = s.current;
    sync();
    phase = 'running';
  }

  function sync() {
    if (!session) return;
    progress = session.progress;
    done = session.doneCount;
    total = session.total;
  }

  function advance() {
    const s = session;
    if (!s) return;
    if (s.finished) finish();
    else item = s.current;
  }

  // Handlers are guarded by item.seq: a component that is still sliding out can't act twice.
  function onanswer(grade: Grade, correct: boolean) {
    const s = session;
    const it = item;
    if (!s || !it || it.mode === 'intro' || answeredSeq === it.seq) return;
    answeredSeq = it.seq;
    const { first } = s.answer(correct);
    if (first && it.card.id != null) pending.push(recordAnswer(it.card.id, grade).catch(console.error));
    sync();
  }

  function onnext() {
    if (!item || answeredSeq !== item.seq) return;
    advance();
  }

  function onseen() {
    const s = session;
    if (!s || item?.mode !== 'intro' || s.current?.seq !== item.seq) return;
    s.seen();
    sync();
    advance();
  }

  function finish() {
    const s = session;
    if (!s) return;
    stopSpeaking();
    results = { correct: s.firstTryCorrect, total: s.total, missed: s.missed };
    item = undefined;
    phase = 'results';
    becameHard = [];
    const missed = s.missed;
    void Promise.allSettled(pending).then(async () => (becameHard = await newlyHard(missed, missesBefore)));
  }

  function close() {
    stopSpeaking();
    back(backTo);
  }

  /** Typed modes stay mounted between their questions so the iOS keyboard stays up. */
  const stageKey = $derived(
    !item ? '' : item.mode === 'write' || item.mode === 'listen' || item.mode === 'verbs' ? item.mode : `${item.mode}-${item.seq}`,
  );
</script>

<div class="page learn">
  <SessionBar
    {title}
    count={phase === 'running' ? `${done} / ${total}` : ''}
    ratio={phase === 'running' ? progress : null}
    onclose={close}
  />

  {#if phase === 'loading'}
    <div class="empty">Loading…</div>
  {:else if phase === 'empty'}
    <div class="caught-up stack">
      {#if noWords}
        <div class="big-msg">No words yet</div>
        <div class="muted">Add some words first, then come back to learn them.</div>
        <button class="btn btn-lg btn-block" onclick={close}>Back</button>
      {:else}
        <div class="emoji" aria-hidden="true">🎉</div>
        <div class="big-msg">All caught up</div>
        <div class="muted">Nothing is due right now. Come back later — or keep going:</div>
        {#if anyway}
          <button class="btn btn-primary btn-lg btn-block" onclick={learnAnyway}>Learn new words anyway</button>
        {/if}
        <button class="btn btn-lg btn-block" class:btn-primary={!anyway} onclick={() => go(modesPath)}>More ways to study</button>
      {/if}
    </div>
  {:else if phase === 'running' && item}
    <div class="stage">
      {#key stageKey}
        <div class="slide" in:slideIn out:slideOut>
          {#if item.mode === 'intro'}
            <SmartIntro {item} {onseen} />
          {:else if item.mode === 'flashcards'}
            <Flashcards {item} {onanswer} {onnext} />
          {:else if item.mode === 'write'}
            <Write {item} {onanswer} {onnext} />
          {:else if item.mode === 'listen'}
            <Listen {item} {onanswer} {onnext} />
          {:else if item.mode === 'verbs'}
            <Verbs {item} {onanswer} {onnext} />
          {:else if item.mode === 'choice'}
            <Choice {item} {pool} {onanswer} {onnext} />
          {:else if item.mode === 'articles'}
            <Articles {item} {onanswer} {onnext} />
          {/if}
        </div>
      {/key}
    </div>
  {:else if phase === 'results' && results}
    <SessionResults correct={results.correct} total={results.total} missed={results.missed} {becameHard}>
      {#snippet actions()}
        <button class="btn btn-primary btn-lg btn-block" onclick={load}>Keep going</button>
        <button class="btn btn-lg btn-block" onclick={close}>Done</button>
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
  .caught-up {
    text-align: center;
    padding: 48px 8px 0;
  }
  .emoji {
    font-size: 56px;
    line-height: 1;
  }
  .big-msg {
    font-size: 24px;
    font-weight: 700;
  }
</style>
