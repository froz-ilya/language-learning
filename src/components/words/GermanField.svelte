<script lang="ts">
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import Icon from '../Icon.svelte';
  import ArticleChoices from '../ArticleChoices.svelte';
  import SuggestionRow from './SuggestionRow.svelte';
  import { dur } from '../../lib/motion';
  import { settings } from '../../lib/settings.svelte';
  import { i18n, t } from '../../lib/i18n.svelte';
  import { takeKeyboard } from '../../lib/ui/keyboard';
  import type { SearchRow } from '../../lib/search/results';
  import type { CardDraft } from '../../lib/words/cardDraft.svelte';
  import type { Lang } from '../../lib/types';

  /**
   * The word field of the add panel and the edit page, with its drop-down of words.
   * New words: the field also takes a Russian or English word and offers the German words it
   * translates; Return looks the word up, a second Return adds it (`onadd`). The keyboard stays
   * up while adding: buttons keep the focus (draft.keepFocus), and the blur of a tap on a row is
   * held back so the pick wins.
   */
  let {
    draft,
    autofocus = false,
    onadd,
  }: {
    draft: CardDraft;
    /** Take over the keyboard opened by primeKeyboard() (see lib/ui/keyboard). */
    autofocus?: boolean;
    onadd?: () => void;
  } = $props();

  const isNew = $derived(draft.isNew);
  let inputEl = $state<HTMLInputElement>();
  let suggestEl = $state<HTMLElement>();
  /** A finger / mouse is down on a suggestion: the field's blur must not act before the pick. */
  let picking = false;
  /** The field's blur is handled a moment later, so a tap on a suggestion can win (see afterBlur). */
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  const BLUR_GRACE_MS = 120;

  const s = $derived(draft.suggestions);
  const hasRows = $derived(!!(s.german.length || s.reverse.length));

  function pickRow(row: SearchRow, fromLang: Lang | null) {
    // The tap may have blurred the field already (iOS): its deferred blur must not look up the typed text.
    picking = false;
    clearTimeout(blurTimer);
    if (isNew) {
      inputEl?.focus(); // quick add keeps the keyboard up for the next word (inside the tap, for iOS)
    } else {
      inputEl?.blur();
      draft.focused = false;
    }
    draft.pick(row, fromLang);
  }

  /**
   * Suggestion buttons keep the field focused. iOS may still blur it on a tap, so `picking` also
   * holds back the deferred blur until the click arrives or the pointer is released elsewhere.
   */
  function onSuggestionPointerdown(e: PointerEvent) {
    picking = true;
    draft.keepFocus(e);
  }

  /** Released without a pick (finger slid off, list scrolled): finish the held-back blur. */
  function onWindowPointerEnd() {
    if (!picking) return;
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      picking = false;
      afterBlur();
    }, BLUR_GRACE_MS);
  }

  function onFocus() {
    clearTimeout(blurTimer);
    draft.focused = true;
  }

  function onBlur() {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(afterBlur, BLUR_GRACE_MS);
  }

  /** Keyboard focus left the suggestion list (Tab): handle it like leaving the field. */
  function onSuggestionsFocusout(e: FocusEvent) {
    if (e.relatedTarget instanceof Node && suggestEl?.contains(e.relatedTarget)) return;
    clearTimeout(blurTimer);
    blurTimer = setTimeout(afterBlur, BLUR_GRACE_MS);
  }

  function afterBlur() {
    const active = document.activeElement;
    if (picking || active === inputEl || (active && suggestEl?.contains(active))) return;
    draft.focused = false;
    // A Russian word is only searched for: it's never looked up as German.
    if (draft.cyrillic) return;
    draft.applyParsed();
    const term = draft.card.term.trim();
    // Leaving the field with a fresh word on a new card: look it up automatically.
    if (isNew && term && term !== draft.lastLookedUp && !draft.card.translation.trim()) {
      void draft.runLookup();
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // Quick add: Return looks the word up, a second Return adds it.
    if (isNew && !draft.showDetails && draft.lookupState === 'done' && draft.card.term.trim() === draft.lastLookedUp) onadd?.();
    else void draft.runLookup();
  }

  function clearTerm() {
    draft.clearTerm();
    inputEl?.focus();
  }

  onMount(() => {
    draft.focusField = () => inputEl?.focus();
    if (autofocus) takeKeyboard(inputEl);
    return () => {
      clearTimeout(blurTimer);
      draft.focusField = () => {};
    };
  });
</script>

<svelte:window onpointerup={onWindowPointerEnd} onpointercancel={onWindowPointerEnd} />

<div class="field">
  <!-- Adding: the field also takes Russian / English, so no "German" label (named by aria-label). -->
  {#if !isNew}<label for="german">{t('common.german')}</label>{/if}
  <div class="row">
    <div class="input-wrap">
      <input
        id="german"
        class="input german"
        class:big={isNew}
        bind:this={inputEl}
        aria-label={isNew ? t('library.addWord') : undefined}
        bind:value={draft.card.term}
        oninput={() => draft.onInput()}
        onfocus={onFocus}
        onblur={onBlur}
        onkeydown={onKeydown}
        placeholder={isNew ? t('words.editor.placeholderAny') : t('words.editor.placeholderEdit')}
        autocapitalize="off"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        lang={draft.cyrillic ? 'ru' : 'de'}
        enterkeyhint={isNew && draft.lookupState === 'done' ? 'done' : 'search'}
      />
      {#if isNew && draft.card.term}
        <button type="button" class="clear" aria-label={t('words.clear')} onpointerdown={draft.keepFocus} onclick={clearTerm}>
          <Icon name="x" size={16} />
        </button>
      {/if}
    </div>
    {#if !isNew}
      <button
        type="button"
        class="btn lookup"
        onclick={() => draft.runLookup()}
        disabled={draft.lookupState === 'loading'}
        aria-label={t('words.lookUp')}
      >
        <Icon name="sparkle" size={20} />
        <span>{t('words.lookUp')}</span>
      </button>
    {/if}
  </div>
  {#if hasRows && draft.focused}
    <div class="list suggestions" role="listbox" bind:this={suggestEl} onfocusout={onSuggestionsFocusout} transition:slide={{ duration: dur(150) }}>
      {#each s.german as r}
        <SuggestionRow
          row={r}
          hintLang={settings.lang}
          inSet={isNew && draft.rowInSet(r)}
          onpointerdown={onSuggestionPointerdown}
          onclick={() => pickRow(r, null)}
        />
      {/each}
      {#if s.reverse.length && s.reverseLang}
        {@const from = s.reverseLang}
        <div class="group-title" role="presentation" lang={i18n.lang}>
          {from === 'ru' ? t('words.search.fromRussian') : t('words.search.fromEnglish')}
        </div>
        {#each s.reverse as r}
          <SuggestionRow
            row={r}
            hintLang={from}
            stacked
            inSet={draft.rowInSet(r)}
            onpointerdown={onSuggestionPointerdown}
            onclick={() => pickRow(r, from)}
          />
        {/each}
      {/if}
    </div>
  {/if}
  {#if draft.error}<div class="status small bad">{draft.error}</div>{/if}
  {#if !isNew}
    {#if draft.lookupState === 'loading'}
      <div class="status small muted">{t('words.editor.lookingUp')}</div>
    {:else if draft.lookupState === 'error'}
      <div class="status small bad">{t('words.editor.lookupFailed')}</div>
    {:else if draft.lookupState === 'notfound'}
      <div class="status small muted">{t('words.editor.notInDictionary')}</div>
    {:else if draft.lookupState === 'done'}
      <div class="status small good">{t('words.editor.filledIn')}</div>
    {/if}
    {#if draft.lookupState === 'done' && draft.articles.length > 1}
      <div class="article-pick" transition:slide={{ duration: dur(180) }}>
        <div class="small muted">{t('words.editor.articlesPick')}</div>
        <ArticleChoices
          term={draft.card.term}
          articles={draft.articles}
          selected={draft.pickedArticle}
          trLang={settings.lang}
          onpick={draft.chooseArticle}
        />
      </div>
    {/if}
  {/if}
</div>

<style>
  .input-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  .german {
    font-size: 17px;
  }
  .german.big {
    min-height: 56px;
    font-family: var(--font-display);
    font-size: 21px;
    font-weight: 700;
    padding-right: 44px;
  }
  .clear {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--muted);
    cursor: pointer;
  }
  .lookup {
    flex-shrink: 0;
    color: var(--accent);
    padding: 10px 12px;
  }
  .status {
    margin-left: 4px;
  }
  .group-title {
    padding: 10px 16px 4px;
    border-top: 1px solid var(--border);
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--muted);
  }
  .group-title:first-child {
    border-top: 0;
  }
  .article-pick {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 4px 0 2px;
  }
</style>
