<script lang="ts">
  import { onMount } from 'svelte';
  import EndingTable from '../components/grammar/EndingTable.svelte';
  import EndingText from '../components/grammar/EndingText.svelte';
  import NounSheet from '../components/grammar/NounSheet.svelte';
  import Formula from '../components/grammar/Formula.svelte';
  import Highlighted from '../components/grammar/Highlighted.svelte';
  import RelativeTable from '../components/grammar/RelativeTable.svelte';
  import Header from '../components/Header.svelte';
  import { stagger } from '../components/library/actions';
  import { topicById } from '../lib/grammar/content';
  import { CASE_NAMES } from '../lib/grammar/endings';
  import type { TopicId } from '../lib/grammar/types';
  import { i18n, t } from '../lib/i18n.svelte';
  import { dur, enter } from '../lib/motion';
  import { go, replace, route } from '../lib/router.svelte';
  import { settings } from '../lib/settings.svelte';

  // Route: #/grammar/<topic id> (constant: remounted on navigation). Every grammar route that
  // resolves to nothing else ends up here too, and goes back to the start.
  const topic = route.parts.length === 2 ? topicById(route.parts[1] as TopicId) : undefined;

  onMount(() => {
    if (!topic) replace('/grammar');
  });
</script>

{#if topic}
  <div class="page">
    <div class="head"><Header title={topic.title[i18n.lang]} backTo="/grammar/area/{topic.area}" /></div>

    <section class="card rule" in:enter|global={{ y: 12, duration: dur(240) }}>
      <p class="summary">{topic.summary[i18n.lang]}</p>
      <div class="formula"><Formula text={topic.formula[i18n.lang]} /></div>
    </section>

    {#if topic.area === 'endings'}
      <section class="card table" in:enter|global={{ y: 12, duration: dur(240), delay: stagger(1, 40) }}>
        <EndingTable declension={topic.declension} />
        {#if topic.declension === 'ein'}<p class="small muted foot">{t('grammar.einPlural')}</p>{/if}
      </section>
    {:else if topic.area === 'relative'}
      <section class="card table" in:enter|global={{ y: 12, duration: dur(240), delay: stagger(1, 40) }}>
        <RelativeTable />
        <p class="small muted foot">{t('grammar.relativeDiffers')}</p>
      </section>
    {/if}

    <ul class="small points" in:enter|global={{ y: 12, duration: dur(240), delay: stagger(1, 40) }}>
      {#each topic.points as point}
        <li>{point[i18n.lang]}</li>
      {/each}
    </ul>

    <section class="section" in:enter|global={{ y: 12, duration: dur(240), delay: stagger(2, 40) }}>
      <div class="section-title">{t('grammar.examples')}</div>
      <div class="list">
        {#if topic.area === 'endings'}
          {#each topic.examples as example}
            <div class="list-item example">
              <p lang="de"><EndingText text={example.de} marks={example.marks} nouns /></p>
              <div class="sub">{example.tr[settings.lang]}</div>
            </div>
          {/each}
        {:else if topic.area === 'relative'}
          {#each topic.examples as example}
            <div class="list-item example">
              <p lang="de"><Highlighted text={example.de} connector={example.pronoun} noun={example.noun} verbs={example.verbs} /></p>
              <div class="sub">{example.tr[settings.lang]}</div>
            </div>
          {/each}
        {:else}
          {#each topic.examples as example}
            <div class="list-item example">
              <p lang="de"><Highlighted text={example.de} connector={example.connector} verbs={example.verbs} /></p>
              <div class="sub">{example.tr[settings.lang]}</div>
            </div>
          {/each}
        {/if}
      </div>
    </section>

    <section class="section" in:enter|global={{ y: 12, duration: dur(240), delay: stagger(3, 40) }}>
      {#if topic.area === 'endings' || topic.area === 'relative'}
        <div class="section-title">{t('grammar.cases')}</div>
        <div class="card words">
          {#each topic.patterns as pattern (pattern.id)}
            <div class="word" lang="de">{CASE_NAMES[pattern.case]}</div>
            <div>{pattern.rule[i18n.lang]}</div>
            {#if pattern.note}<div class="small muted note">{pattern.note[i18n.lang]}</div>{/if}
          {/each}
        </div>
      {:else}
        <div class="section-title">{t('grammar.words')}</div>
        <div class="card words">
          {#each topic.connectors as connector}
            <div class="word" lang="de">{connector.word}</div>
            <div>{connector.meaning[settings.lang]}</div>
            {#if connector.note}<div class="small muted note">{connector.note[i18n.lang]}</div>{/if}
          {/each}
        </div>
      {/if}
    </section>

    <button class="btn btn-primary btn-lg btn-block practise" onclick={() => go(`/grammar/${topic.id}/practice`)}>{t('grammar.practise')}</button>
  </div>
  <NounSheet />
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
  .table {
    margin-top: 14px;
    padding: 12px;
  }
  .foot {
    margin: 6px 0 0;
    font-size: 12.5px;
  }
  .points {
    margin: 14px 4px 0;
    padding-left: 18px;
    color: var(--text-2);
  }
  .points li + li {
    margin-top: 6px;
  }
  .example {
    display: block;
    cursor: default;
  }
  .example:active {
    background: none;
  }
  .example p {
    margin: 0 0 2px;
    font-size: 17px;
    line-height: 1.5;
  }
  .words {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 6px 14px;
  }
  .word {
    font-family: var(--font-display);
    font-weight: 800;
  }
  .note {
    grid-column: 1 / -1;
    margin-bottom: 4px;
  }
  .practise {
    position: sticky;
    bottom: calc(var(--safe-bottom) + 8px);
    z-index: 2;
    margin-top: 20px;
  }
</style>
