<script lang="ts" module>
  import type { Gender } from '../lib/types';

  /** One article of a noun whose articles differ in meaning ("der See" / "die See"). */
  export interface Choice {
    genders: Gender[];
    plural: string;
    translation: string;
  }
</script>

<script lang="ts" generics="T extends Choice">
  import Icon from './Icon.svelte';
  import Term from './Term.svelte';
  import { ARTICLE } from '../lib/german/articles';
  import { previewOf } from '../lib/lookup/meanings';

  /**
   * The articles of a noun as separate rows — "der See — озеро · Seen", "die See — море" —
   * each with its article colour. Tapping a row picks it (`onpick`, with `selected` showing the
   * picked one); `onadd` adds a plus button per row, `isAdded` turns it into a check.
   */
  let {
    term,
    articles,
    selected = null,
    onpick,
    onadd,
    isAdded,
    disabled = false,
    trLang,
    onpointerdown,
  }: {
    term: string;
    articles: T[];
    selected?: Gender | null;
    onpick?: (a: T) => void;
    onadd?: (a: T) => void;
    isAdded?: (a: T) => boolean;
    disabled?: boolean;
    /** Language of the translations (settings.lang). */
    trLang?: string;
    /** Lets the caller keep the keyboard up (CardEditor's keepFocus). */
    onpointerdown?: (e: PointerEvent) => void;
  } = $props();
</script>

{#snippet label(a: T, g: Gender)}
  <span class="art" lang="de"><Term card={{ term, pos: 'noun', genders: [g] }} /></span>
  <span class="tr" lang={trLang}>
    <span class="dash muted">—</span>
    {#if a.translation}{previewOf(a.translation) || a.translation}{:else}<span class="muted" lang="en">no translation</span>{/if}
    {#if a.plural}<span class="pl muted" lang="de">· {a.plural}</span>{/if}
  </span>
{/snippet}

<div class="choices" role={onpick ? 'radiogroup' : 'list'} aria-label="Articles">
  {#each articles as a (a.genders[0])}
    {@const g = a.genders[0]}
    {@const on = !!onpick && selected === g}
    {@const added = isAdded?.(a) ?? false}
    <div class="choice" class:on role={onpick ? undefined : 'listitem'}>
      {#if onpick}
        <button type="button" class="main" role="radio" aria-checked={on} {onpointerdown} onclick={() => onpick(a)}>
          {@render label(a, g)}
        </button>
      {:else}
        <div class="main">{@render label(a, g)}</div>
      {/if}
      {#if onadd}
        {#if added}
          <span class="done g-{g}" aria-label="{ARTICLE[g]} {term} is added"><Icon name="check" size={20} /></span>
        {:else}
          <button
            type="button"
            class="add g-{g}"
            aria-label="Add {ARTICLE[g]} {term}"
            {disabled}
            {onpointerdown}
            onclick={() => onadd(a)}><Icon name="plus" size={20} /></button
          >
        {/if}
      {/if}
    </div>
  {/each}
</div>

<style>
  .choices {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 48px;
    padding: 2px 4px 2px 0;
    border-radius: var(--radius-sm);
    background: var(--inset-bg);
    box-shadow: inset 0 0 0 1px var(--hairline);
    transition:
      box-shadow var(--dur-fast) var(--ease),
      background-color var(--dur-fast) var(--ease);
  }
  .choice.on {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 2px 8px;
    padding: 8px 12px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
  }
  button.main {
    cursor: pointer;
  }
  .art {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
    white-space: nowrap;
  }
  .tr {
    min-width: 0;
    font-size: 16px;
    color: var(--text-2);
    overflow-wrap: anywhere;
  }
  .dash {
    margin-right: 2px;
  }
  .pl {
    white-space: nowrap;
  }
  .add,
  .done {
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
  }
  .add {
    border: 0;
    background: color-mix(in srgb, currentColor 14%, var(--surface));
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, currentColor 35%, transparent);
    cursor: pointer;
    transition:
      transform var(--dur-fast) var(--ease),
      opacity var(--dur-fast) var(--ease);
  }
  .add:active {
    transform: scale(0.92);
  }
  .add:disabled {
    opacity: 0.5;
  }
</style>
