<script lang="ts">
  import { onMount } from 'svelte';
  import BuildTiles from '../components/grammar/BuildTiles.svelte';
  import EndingGaps from '../components/grammar/EndingGaps.svelte';
  import EndingText from '../components/grammar/EndingText.svelte';
  import Highlighted from '../components/grammar/Highlighted.svelte';
  import NounSheet from '../components/grammar/NounSheet.svelte';
  import PickBlank from '../components/grammar/PickBlank.svelte';
  import { areaTitle, wordFullTitle } from '../components/grammar/connectors';
  import Icon from '../components/Icon.svelte';
  import SessionBar from '../components/study/SessionBar.svelte';
  import SessionResults from '../components/study/SessionResults.svelte';
  import { allExercises, areaById, areaExercises, GRAMMAR_STAGES, stageById, stageNumber, topicById } from '../lib/grammar/content';
  import { anywaySession, reviewSession, stageSession, wordExercises, wordSession } from '../lib/grammar/path';
  import { endingMarks, fullSentence, GrammarSession, marksOf, pickExercises } from '../lib/grammar/practice';
  import { loadProgress, recordGrammar } from '../lib/grammar/store';
  import type { GrammarExercise, GrammarProgress, TopicId } from '../lib/grammar/types';
  import { fmtNumber, i18n, t } from '../lib/i18n.svelte';
  import { trackLoad } from '../lib/pageLoad';
  import { back, replace, route } from '../lib/router.svelte';
  import { settings } from '../lib/settings.svelte';
  import { stopSpeaking } from '../lib/speech/tts';
  import { slideIn, slideOut } from '../lib/study/fx';

  const SESSION_SIZE = 12;

  /** What a route practises. `title` is a function: the interface language can change. */
  interface Source {
    title: () => string;
    backTo: string;
    pick: (progress: Map<string, GrammarProgress>, now: number) => GrammarExercise[];
  }

  /** Route (constant: remounted on navigation): one of the /grammar/…/practice pages, or nothing. */
  function resolve(parts: string[]): Source | undefined {
    const [, kind, id, last] = parts;
    const pool = allExercises();
    if (kind === 'stage' && last === 'practice' && parts.length === 4) {
      const stage = stageById(Number(id));
      return (
        stage && {
          title: () => t('grammar.stage', { n: stageNumber(stage) }),
          backTo: `/grammar/stage/${stage.id}`,
          pick: (progress, now) => stageSession(stage, pool, progress, now),
        }
      );
    }
    if (kind === 'area' && last === 'practice' && parts.length === 4) {
      const area = areaById(id);
      return (
        area && {
          title: () => areaTitle(area.id),
          backTo: `/grammar/area/${area.id}`,
          pick: (progress, now) => pickExercises(areaExercises(area), progress, now, SESSION_SIZE),
        }
      );
    }
    if (kind === 'word' && last === 'practice' && parts.length === 4) {
      if (!wordExercises(id, pool).length) return undefined;
      const stage = GRAMMAR_STAGES.find((s) => s.words.includes(id));
      return {
        title: () => wordFullTitle(id),
        backTo: stage ? `/grammar/stage/${stage.id}` : '/grammar',
        pick: (progress, now) => wordSession(id, pool, progress, now),
      };
    }
    if (id !== 'practice' || parts.length !== 3) return undefined;
    if (kind === 'review') {
      return { title: () => t('grammar.review'), backTo: '/grammar', pick: (progress, now) => reviewSession(pool, progress, now) };
    }
    if (kind === 'anyway') {
      return { title: () => t('grammar.anyway'), backTo: '/grammar', pick: (progress, now) => anywaySession(pool, GRAMMAR_STAGES, progress, now) };
    }
    if (kind === 'all') {
      return { title: () => t('grammar.practiseAll'), backTo: '/grammar', pick: (progress, now) => pickExercises(pool, progress, now, SESSION_SIZE) };
    }
    const topic = topicById(kind as TopicId);
    return (
      topic && {
        title: () => topic.title[i18n.lang],
        backTo: `/grammar/${topic.id}`,
        pick: (progress, now) => pickExercises(topic.exercises, progress, now, SESSION_SIZE),
      }
    );
  }

  const source = resolve(route.parts);

  type Phase = 'loading' | 'empty' | 'running' | 'results';
  let phase = $state<Phase>('loading');

  let session: GrammarSession | null = null;
  let item = $state.raw<{ exercise: GrammarExercise; seq: number } | undefined>();
  let answeredSeq = -1;
  let done = $state(0);
  let total = $state(0);
  /** Repeat-mistakes rounds don't write progress (the first round already counted those). */
  let repeat = $state(false);
  let run = $state(0);
  let results = $state.raw<{ total: number; correct: number; missed: GrammarExercise[] } | null>(null);

  async function load(from: Source) {
    const loaded = trackLoad();
    try {
      const exercises = from.pick(await loadProgress(), Date.now());
      if (exercises.length) start(exercises);
      else phase = 'empty';
    } catch (e) {
      console.error(e);
      phase = 'empty';
    } finally {
      loaded();
    }
  }
  if (source) load(source);
  onMount(() => {
    if (!source) replace('/grammar');
  });

  function show(s: GrammarSession) {
    const exercise = s.current;
    item = exercise && { exercise, seq: s.seq };
  }

  function start(exercises: GrammarExercise[]) {
    run++;
    results = null;
    session = new GrammarSession(exercises);
    total = session.total;
    done = 0;
    answeredSeq = -1;
    show(session);
    phase = 'running';
  }

  // Guarded by seq: a question that is still sliding out can't answer twice.
  function onanswer(ok: boolean) {
    const s = session;
    if (!s || !item || answeredSeq === item.seq) return;
    answeredSeq = item.seq;
    const { first } = s.answer(ok);
    if (first && !repeat) recordGrammar(item.exercise.id, ok).catch(console.error);
    done = s.doneCount;
  }

  function onnext() {
    const s = session;
    if (!s || !item || answeredSeq !== item.seq) return;
    if (s.finished) finish(s);
    else show(s);
  }

  function finish(s: GrammarSession) {
    stopSpeaking();
    results = { total: s.total, correct: s.firstTryCorrect, missed: s.missed };
    item = undefined;
    phase = 'results';
  }

  function repeatMistakes() {
    if (!results?.missed.length) return;
    repeat = true;
    start(results.missed);
  }

  function close() {
    stopSpeaking();
    back(source?.backTo ?? '/grammar');
  }

  const name = $derived(source?.title() ?? '');
</script>

{#if source}
<div class="page study">
  <SessionBar
    title={repeat ? t('study.session.repeatTitle', { mode: name }) : name}
    count={phase === 'running' ? `${fmtNumber(done)} / ${fmtNumber(total)}` : ''}
    ratio={phase === 'running' ? (total ? done / total : 0) : null}
    onclose={close}
  />

  {#if phase === 'loading'}
    <div class="empty">{t('common.loading')}</div>
  {:else if phase === 'empty'}
    <div class="empty stack">
      <div>{t('grammar.empty')}</div>
      <button class="btn btn-block" onclick={close}>{t('common.back')}</button>
    </div>
  {:else if phase === 'running'}
    <div class="stage">
      {#if item}
        {#key `${run}-${item.seq}`}
          <div class="slide" in:slideIn out:slideOut>
            {#if item.exercise.kind === 'build'}
              <BuildTiles exercise={item.exercise} {onanswer} {onnext} />
            {:else if item.exercise.kind === 'ending'}
              <EndingGaps exercise={item.exercise} {onanswer} {onnext} />
            {:else}
              <PickBlank exercise={item.exercise} {onanswer} {onnext} />
            {/if}
          </div>
        {/key}
      {/if}
    </div>
  {:else if phase === 'results' && results}
    <SessionResults correct={results.correct} total={results.total} missed={[]} missedCount={results.missed.length} celebrate={!repeat}>
      {#snippet missedList()}
        <div class="list">
          {#each results?.missed ?? [] as ex (ex.id)}
            <div class="list-item missed">
              <p class="sentence" lang="de">
                {#if ex.kind === 'ending'}<EndingText text={fullSentence(ex)} marks={endingMarks(ex)} />{:else}<Highlighted text={fullSentence(ex)} {...marksOf(ex)} />{/if}
              </p>
              <div class="sub">{ex.tr[settings.lang]}</div>
            </div>
          {/each}
        </div>
      {/snippet}
      {#snippet actions()}
        {#if results?.missed.length}
          <button class="btn btn-primary btn-lg btn-block" onclick={repeatMistakes}>
            <Icon name="refresh" /> {t('study.session.repeatMistakes')}
          </button>
          <button class="btn btn-lg btn-block" onclick={close}>{t('common.done')}</button>
        {:else}
          <button class="btn btn-primary btn-lg btn-block" onclick={close}>{t('common.done')}</button>
        {/if}
      {/snippet}
    </SessionResults>
  {/if}
</div>
<NounSheet />
{/if}

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
  .missed {
    display: block;
    cursor: default;
  }
  .missed:active {
    background: none;
  }
  .sentence {
    margin: 0 0 2px;
    line-height: 1.5;
  }
</style>
