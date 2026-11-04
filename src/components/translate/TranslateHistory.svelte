<script lang="ts">
  import SwipeRow from '../SwipeRow.svelte';
  import { i18n, t } from '../../lib/i18n.svelte';
  import type { HistoryItem } from '../../lib/translate/translate';

  /** Recent translations: tap restores one, swipe left removes it, "Clear" empties the list. */
  let {
    items,
    onpick,
    onremove,
    onclear,
  }: {
    items: HistoryItem[];
    onpick: (item: HistoryItem) => void;
    onremove: (item: HistoryItem) => void;
    onclear: () => void;
  } = $props();

  const tag = (l: string) => l.toUpperCase();
</script>

<section class="section history">
  <h2 class="section-title" lang={i18n.lang}>
    {t('translator.recent')}
    <button type="button" class="link" onclick={onclear}>{t('words.clear')}</button>
  </h2>
  <div class="list">
    {#each items as item (item.at)}
      <SwipeRow left={{ label: t('translator.remove'), icon: 'trash', tone: 'bad', run: () => onremove(item) }}>
        <button type="button" class="list-item row-btn" onclick={() => onpick(item)}>
          <span class="dir" aria-hidden="true">{tag(item.from)} → {tag(item.to)}</span>
          <span class="grow">
            <span class="title clamp" lang={item.from}>{item.text}</span>
            <span class="sub clamp" lang={item.to}>{item.result}</span>
          </span>
        </button>
      </SwipeRow>
    {/each}
  </div>
</section>

<style>
  .link {
    border: 0;
    background: none;
    padding: 4px 0 4px 8px;
    color: var(--accent);
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    cursor: pointer;
  }
  .row-btn {
    align-items: flex-start;
    min-height: 56px;
    padding: 10px 16px;
  }
  .dir {
    flex-shrink: 0;
    margin-top: 3px;
    padding: 2px 6px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--muted);
    font-family: var(--font-display);
    font-size: 10.5px;
    font-weight: 900;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .clamp {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
</style>
