<script lang="ts">
  import { onMount } from 'svelte';
  import { connectorOf, patternOf, relativePatternOf, wordTitle } from '../components/grammar/connectors';
  import EndingText from '../components/grammar/EndingText.svelte';
  import Formula from '../components/grammar/Formula.svelte';
  import Highlighted from '../components/grammar/Highlighted.svelte';
  import StatRing from '../components/grammar/StatRing.svelte';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import { allExercises, stageById, stageNumber, topicById } from '../lib/grammar/content';
  import { stageStats } from '../lib/grammar/path';
  import { loadProgress } from '../lib/grammar/store';
  import { i18n, t } from '../lib/i18n.svelte';
  import { live } from '../lib/live.svelte';
  import { dur, enter } from '../lib/motion';
  import { go, replace, route } from '../lib/router.svelte';
  import { settings } from '../lib/settings.svelte';

  // Route: #/grammar/stage/<id> (constant: remounted on navigation).
  const stage = stageById(Number(route.parts[2]));

  onMount(() => {
    if (!stage) replace('/grammar');
  });

  const stats = live(async () => (stage ? stageStats(stage, allExercises(), await loadProgress(), Date.now()) : undefined));
  const topic = stage && topicById(stage.topic);
</script>

{#snippet doneMark()}
  <span class="done-mark" role="img" aria-label={t('common.done')}><Icon name="check" size={22} /></span>
{/snippet}

{#if stage && topic}
  <div class="page">
    <div class="head">
      <Header title={topic.title[i18n.lang]} subtitle={t('grammar.stage', { n: stageNumber(stage) })} backTo="/grammar/area/{topic.area}" actions={stats.value?.done ? doneMark : undefined} />
    </div>

    <section class="card rule" in:enter|global={{ y: 12, duration: dur(240) }}>
      <p class="summary">{topic.summary[i18n.lang]}</p>
      <div class="formula"><Formula text={topic.formula[i18n.lang]} /></div>
    </section>

    <p class="small contrast" in:enter|global={{ y: 12, duration: dur(240) }}>{stage.contrast[i18n.lang]}</p>

    <section class="section" in:enter|global={{ y: 12, duration: dur(240) }}>
      <div class="section-title">{topic.area !== 'order' ? t('grammar.cases') : t('grammar.words')}</div>
      <div class="list">
        {#each stage.words as word (word)}
          {@const s = stats.value?.words.find((w) => w.word === word)?.stats}
          <a class="list-item" href="#/grammar/word/{encodeURIComponent(word)}/practice">
            <StatRing ratio={s?.ratio ?? 0} done={s?.done} size={40} />
            {#if topic.area === 'endings'}
              {@const pattern = patternOf(word)}
              <span class="text">
                <span class="title word" lang="de">{wordTitle(word)}</span>
                {#if pattern}
                  <span class="sub">{pattern.rule[i18n.lang]}</span>
                  <span class="small example" lang="de"><EndingText text={pattern.example.de} marks={pattern.example.marks} /></span>
                {/if}
              </span>
            {:else if topic.area === 'relative'}
              {@const pattern = relativePatternOf(word)}
              <span class="text">
                <span class="title word" lang="de">{wordTitle(word)}</span>
                {#if pattern}
                  <span class="sub">{pattern.rule[i18n.lang]}</span>
                  <span class="small example" lang="de"><Highlighted text={pattern.example.de} connector={pattern.example.pronoun} noun={pattern.example.noun} verbs={pattern.example.verbs} /></span>
                {/if}
              </span>
            {:else}
              {@const connector = connectorOf(word)}
              <span class="text">
                <span class="title word" lang="de">{word}</span>
                <span class="sub">{connector?.meaning[settings.lang]}</span>
                {#if connector}
                  <span class="small example" lang="de"><Highlighted text={connector.example.de} connector={connector.example.connector} verbs={connector.example.verbs} /></span>
                {/if}
              </span>
            {/if}
            <span class="chev"><Icon name="chevron" size={18} /></span>
          </a>
        {/each}
      </div>
      <div class="list full-rule">
        <a class="list-item" href="#/grammar/{topic.id}">
          <span class="text"><span class="title">{t('grammar.fullRule')}</span></span>
          <span class="chev"><Icon name="chevron" size={18} /></span>
        </a>
      </div>
    </section>

    <button class="btn btn-primary btn-lg btn-block practise" onclick={() => go(`/grammar/stage/${stage.id}/practice`)}>{t('grammar.practise')}</button>
  </div>
{/if}

<style>
  /* Topic titles are sentences, longer than a page title: they wrap instead of being cut. */
  .head :global(h1) {
    font-size: 24px;
    line-height: 1.2;
    white-space: normal;
  }
  .rule {
    border-radius: var(--radius-lg);
    background: var(--grad-feature);
  }
  .summary {
    margin: 0;
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
    line-height: 1.35;
  }
  .formula {
    margin-top: 12px;
  }
  .contrast {
    margin: 14px 4px 0;
    line-height: 1.45;
    color: var(--text-2);
  }
  .done-mark {
    display: inline-flex;
    padding: 0 8px;
    color: var(--good);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .word {
    font-family: var(--font-display);
    font-weight: 800;
  }
  /* Line height leaves room for the verb's filled background across two lines. */
  .example {
    margin-top: 3px;
    line-height: 1.6;
  }
  .chev {
    display: inline-flex;
    color: var(--faint);
  }
  .full-rule {
    margin-top: 12px;
  }
  .practise {
    position: sticky;
    bottom: calc(var(--safe-bottom) + 8px);
    z-index: 2;
    margin-top: 20px;
  }
</style>
