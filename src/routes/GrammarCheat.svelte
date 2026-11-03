<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import EndingTable from '../components/grammar/EndingTable.svelte';
  import Formula from '../components/grammar/Formula.svelte';
  import Highlighted from '../components/grammar/Highlighted.svelte';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import { areaShort } from '../components/grammar/connectors';
  import { AREA_IDS, areaById, ENDING_TOPICS, ORDER_TOPICS, topicById } from '../lib/grammar/content';
  import type { AreaId } from '../lib/grammar/types';
  import { i18n, t } from '../lib/i18n.svelte';
  import { dur, enter } from '../lib/motion';
  import { replace, route } from '../lib/router.svelte';
  import { settings } from '../lib/settings.svelte';

  /** The area last looked at, so /grammar/cheat opens where homework left off. */
  const AREA_KEY = 'grammar.cheatArea';

  function savedArea(): AreaId {
    try {
      const v = localStorage.getItem(AREA_KEY);
      return v && areaById(v) ? (v as AreaId) : AREA_IDS[0];
    } catch {
      return AREA_IDS[0];
    }
  }

  // Route: #/grammar/cheat/<area>, or #/grammar/cheat for the last one (constant: remounted on navigation).
  const asked = route.parts[2];
  const area: AreaId = asked && areaById(asked) ? (asked as AreaId) : savedArea();

  onMount(() => {
    if (asked !== area) replace(`/grammar/cheat/${area}`);
    try {
      localStorage.setItem(AREA_KEY, area);
    } catch {
      // Private mode: the switch still works, it just isn't remembered.
    }
  });

  /** How long a word stays marked after a jump from the index. */
  const LIT_MS = 1400;

  const everywhere = topicById('verb-end')?.points ?? [];

  /** The id of an ending topic's table. */
  const tableId = (topic: string) => `cheat-${topic}`;

  /** The id of a word's row; a word could stand in two patterns, so it isn't the word itself. */
  const rowId = (topic: number, word: number) => `cheat-${topic}-${word}`;

  /** Scrolled this far, the index is out of sight and the way back to it shows. */
  const INDEX_GONE = 500;

  let lit = $state('');
  let scrollY = $state(0);
  let timer: ReturnType<typeof setTimeout> | undefined;

  // A lookup, not a tour: the page is long, so jumps are instant.
  function jump(id: string) {
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
    lit = id;
    clearTimeout(timer);
    timer = setTimeout(() => (lit = ''), LIT_MS);
  }

  onDestroy(() => clearTimeout(timer));
</script>

<svelte:window bind:scrollY />

<div class="page">
  <Header title={t('grammar.cheat')} backTo="/grammar" />

  <!-- One area at a time: a switch, not a scroll past the other. Instant, like the jumps. -->
  <div class="segmented areas" role="tablist" aria-label={t('grammar.cheat')}>
    {#each AREA_IDS as id (id)}
      <button role="tab" aria-selected={id === area} class:active={id === area} onclick={() => id !== area && replace(`/grammar/cheat/${id}`)}>{areaShort(id)}</button>
    {/each}
  </div>

  <div in:enter|global={{ y: 8, duration: dur(200) }}>
    {#if area === 'order'}
      <nav class="card index" aria-label={t('grammar.cheatIndex')}>
        {#each ORDER_TOPICS as topic, ti (topic.id)}
          <div class="group">
            <div class="cap">{topic.title[i18n.lang]}</div>
            <div class="chips">
              {#each topic.connectors as connector, ci (connector.word)}
                <button class="chip jump" lang="de" onclick={() => jump(rowId(ti, ci))}>{connector.word}</button>
              {/each}
            </div>
          </div>
        {/each}
      </nav>

      {#each ORDER_TOPICS as topic, ti (topic.id)}
        <section class="pattern">
          <h2>{topic.title[i18n.lang]}</h2>
          <div class="formula"><Formula text={topic.formula[i18n.lang]} /></div>
          <div class="list">
            {#each topic.connectors as connector, ci (connector.word)}
              {@const id = rowId(ti, ci)}
              {@const start = connector.start}
              <div class="entry" class:lit={lit === id} {id}>
                <div class="head">
                  <span class="word" lang="de">{connector.word}</span>
                  <span class="meaning">{connector.meaning[settings.lang]}</span>
                </div>
                <p class="sentence" lang="de"><Highlighted text={connector.example.de} connector={connector.example.connector} verbs={connector.example.verbs} /></p>
                <div class="tr">{connector.example.tr[settings.lang]}</div>
                {#if connector.note}<div class="note">{connector.note[i18n.lang]}</div>{/if}
                <div class="start">
                  <div class="rule">{start.rule[i18n.lang]}</div>
                  {#if start.formula}<div class="start-formula"><Formula compact text={start.formula[i18n.lang]} /></div>{/if}
                  {#if start.example}
                    <p class="sentence" lang="de"><Highlighted text={start.example.de} connector={start.example.connector} verbs={start.example.verbs} /></p>
                    <div class="tr">{start.example.tr[settings.lang]}</div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
          <a class="more" href="#/grammar/{topic.id}">{t('grammar.fullRule')} <Icon name="chevron" size={14} /></a>
        </section>
      {/each}

      <section class="pattern">
        <h2>{t('grammar.allRules')}</h2>
        <ul class="points">
          {#each everywhere as point}
            <li>{point[i18n.lang]}</li>
          {/each}
        </ul>
      </section>
    {:else}
      <!-- Only the tables: the rule for each case is a tap away on the topic page. -->
      <nav class="card index" aria-label={t('grammar.cheatIndex')}>
        <div class="chips">
          {#each ENDING_TOPICS as topic (topic.id)}
            <button class="chip jump" onclick={() => jump(tableId(topic.id))}>{topic.title[i18n.lang] || topic.id}</button>
          {/each}
        </div>
      </nav>

      {#each ENDING_TOPICS as topic (topic.id)}
        {@const id = tableId(topic.id)}
        <section class="pattern endings" {id}>
          <h2>{topic.title[i18n.lang]}</h2>
          <div class="formula"><Formula text={topic.formula[i18n.lang]} /></div>
          <div class="card entry table" class:lit={lit === id}>
            <EndingTable declension={topic.declension} />
            {#if topic.declension === 'ein'}<p class="foot">{t('grammar.einPlural')}</p>{/if}
          </div>
          <a class="more" href="#/grammar/{topic.id}">{t('grammar.fullRule')} <Icon name="chevron" size={14} /></a>
        </section>
      {/each}
    {/if}
  </div>

  {#if scrollY > INDEX_GONE}
    <button class="icon-btn to-index" aria-label={t('grammar.cheatIndex')} onclick={() => window.scrollTo(0, 0)}>
      <span class="up"><Icon name="chevron" size={20} /></span>
    </button>
  {/if}
</div>

<style>
  .to-index {
    position: fixed;
    right: 16px;
    bottom: calc(var(--safe-bottom) + 16px);
    z-index: 20;
    background: var(--surface);
    box-shadow: var(--shadow);
  }
  .up {
    display: inline-flex;
    transform: rotate(-90deg);
  }
  .areas {
    margin-bottom: 12px;
  }
  .index {
    padding: 12px;
  }
  .group + .group {
    margin-top: 10px;
  }
  .cap {
    margin: 0 2px 5px;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .jump {
    min-height: 32px;
    padding: 4px 10px;
    border: 0;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 15px;
    cursor: pointer;
    transition: background-color var(--dur-fast) var(--ease);
  }
  .jump:active {
    background: var(--surface-3);
    transition-duration: 0s;
  }
  .pattern {
    margin-top: 22px;
  }
  h2 {
    margin: 0 4px;
    font-size: 18px;
  }
  .formula {
    margin: 8px 0 10px;
  }
  .entry {
    /* Clear of the status bar and the offline banner, both of which stay on top. */
    scroll-margin-top: calc(var(--safe-top) + 40px);
    padding: 9px 14px 10px;
    font-size: 15.5px;
    line-height: 1.4;
    transition: background-color var(--dur-slow) var(--ease);
  }
  .entry + .entry {
    border-top: 1px solid var(--hairline);
  }
  .entry.lit {
    background: var(--accent-soft);
    transition-duration: 0s;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 8px;
  }
  .word {
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 800;
  }
  .meaning {
    color: var(--text-2);
  }
  .sentence {
    margin: 3px 0 0;
    line-height: 1.5;
  }
  .tr,
  .note {
    font-size: 14px;
    color: var(--muted);
  }
  .note {
    margin-top: 3px;
    color: var(--text-2);
  }
  /* One of 19: a side line under the row, set apart by a rail and a smaller size. */
  .start {
    margin-top: 6px;
    padding-left: 9px;
    border-left: 2px solid var(--hairline);
    font-size: 13px;
    line-height: 1.35;
  }
  .rule {
    color: var(--text-2);
  }
  .start-formula {
    margin-top: 4px;
  }
  .start .sentence {
    margin-top: 4px;
    font-size: 14.5px;
    line-height: 1.45;
  }
  .start .tr {
    font-size: 13px;
  }
  /* The tables: padding trimmed so four columns of phrases fit at 375px. */
  .endings {
    scroll-margin-top: calc(var(--safe-top) + 40px);
  }
  .entry.table {
    padding: 10px 10px 8px;
  }
  .foot {
    margin: 4px 0 0;
    font-size: 12.5px;
    line-height: 1.35;
    color: var(--muted);
  }
  .more {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    min-height: 36px;
    padding: 0 4px;
    margin-top: 2px;
    color: var(--accent);
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
  }
  .points {
    margin: 8px 4px 0;
    padding-left: 18px;
    font-size: 15px;
    line-height: 1.4;
    color: var(--text-2);
  }
  .points li + li {
    margin-top: 5px;
  }
</style>
