<script lang="ts">
  import Icon from '../Icon.svelte';
  import Term from '../Term.svelte';
  import { t } from '../../lib/i18n.svelte';
  import type { SearchRow } from '../../lib/search/results';

  /**
   * A German word offered for the add field. German rows show their translation on the right;
   * rows found by a Russian / English word (`stacked`) show the translation that matched below.
   * `inSet`: the set has this word already (a check).
   */
  let {
    row,
    hintLang,
    stacked = false,
    inSet = false,
    onpointerdown,
    onclick,
  }: {
    row: SearchRow;
    hintLang: string;
    stacked?: boolean;
    inSet?: boolean;
    onpointerdown?: (e: PointerEvent) => void;
    onclick: () => void;
  } = $props();
</script>

<button type="button" class="list-item srow" class:stacked role="option" aria-selected="false" {onpointerdown} {onclick}>
  <span class="title" lang="de"><Term card={{ term: row.term, pos: row.pos, genders: row.gender ? [row.gender] : row.genders }} /></span>
  {#if row.hint || row.form}
    <span class="sub ellipsis" lang={hintLang}
      >{#if row.form}<span lang="de">{row.form} → {row.term}</span>{#if row.hint}{' · '}{/if}{/if}{row.hint}</span
    >
  {/if}
  {#if inSet}<span class="in-set" title={t('words.picker.hasWord')}><Icon name="check" size={18} /></span>{/if}
</button>

<style>
  .srow {
    min-height: 46px;
    padding: 8px 14px;
  }
  .title {
    flex-shrink: 0;
    max-width: 60%;
    overflow-wrap: anywhere;
  }
  .ellipsis {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    color: var(--text-2);
  }
  .stacked {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: 10px;
    row-gap: 1px;
  }
  .stacked .title {
    max-width: none;
  }
  .stacked .ellipsis {
    grid-column: 1;
    text-align: left;
    color: var(--muted);
  }
  .stacked .in-set {
    grid-column: 2;
    grid-row: 1 / span 2;
  }
  .in-set {
    display: inline-flex;
    flex-shrink: 0;
    color: var(--good);
  }
</style>
