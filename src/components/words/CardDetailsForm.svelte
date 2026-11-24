<script lang="ts">
  import { tick } from 'svelte';
  import { slide } from 'svelte/transition';
  import Icon from '../Icon.svelte';
  import SpeakButton from '../SpeakButton.svelte';
  import MeaningChips from './MeaningChips.svelte';
  import { dur } from '../../lib/motion';
  import { settings } from '../../lib/settings.svelte';
  import { t } from '../../lib/i18n.svelte';
  import { ARTICLE } from '../../lib/german/articles';
  import type { CardDraft } from '../../lib/words/cardDraft.svelte';
  import type { Gender, Pos } from '../../lib/types';

  /**
   * The full form of a word: part of speech, article / plural or verb forms, prepositions,
   * translation (with meaning chips), examples and notes. New words: Add / Add and close;
   * editing: Save / Delete.
   */
  let {
    draft,
    onsubmit,
    onaddclose,
    onremove,
  }: {
    draft: CardDraft;
    onsubmit: () => void;
    /** New words: "Add and close". */
    onaddclose?: () => void;
    /** Editing: "Delete word". */
    onremove?: () => void;
  } = $props();

  const card = $derived(draft.card);
  const lang = $derived(settings.lang.toUpperCase());
  let notesEl = $state<HTMLTextAreaElement>();
  let translationEl = $state<HTMLInputElement>();

  const POS: { id: Pos; label: string }[] = [
    { id: 'noun', label: t('words.editor.posNoun') },
    { id: 'verb', label: t('words.editor.posVerb') },
    { id: 'adj', label: t('words.editor.posAdj') },
    { id: 'other', label: t('words.editor.posOther') },
  ];
  const GENDERS: Gender[] = ['m', 'f', 'n'];

  function toggleGender(g: Gender) {
    card.genders = card.genders.includes(g) ? card.genders.filter((x) => x !== g) : GENDERS.filter((x) => x === g || card.genders.includes(x));
  }

  function addExample() {
    card.examples.push({ de: '', tr: '' });
  }

  export async function focusTranslation() {
    await tick();
    translationEl?.focus();
  }

  /** Hard-word nudge: put the cursor where the hook goes. */
  export async function writeHook(kind: 'note' | 'example') {
    if (kind === 'example') addExample();
    await tick();
    const el = kind === 'note' ? notesEl : [...document.querySelectorAll<HTMLTextAreaElement>('textarea.ex-de')].at(-1);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.focus();
  }
</script>

<form class="stack details" transition:slide={{ duration: dur(260) }} onsubmit={(e) => (e.preventDefault(), onsubmit())}>
  <div class="field">
    <span class="label">{t('words.editor.partOfSpeech')}</span>
    <div class="segmented">
      {#each POS as p}
        <button type="button" class:active={card.pos === p.id} onclick={() => (card.pos = p.id)}>{p.label}</button>
      {/each}
    </div>
  </div>

  {#if card.pos === 'noun'}
    <div class="field" transition:slide={{ duration: dur(180) }}>
      <span class="label">{t('words.editor.article')}</span>
      <div class="genders">
        {#each GENDERS as g}
          <button type="button" class="gender g-{g}" class:active={card.genders.includes(g)} aria-pressed={card.genders.includes(g)} onclick={() => toggleGender(g)}
            >{ARTICLE[g]}</button
          >
        {/each}
      </div>
    </div>
    <div class="field">
      <label for="plural">{t('words.editor.plural')} <span class="hint">{t('words.editor.pluralHint')}</span></label>
      <input
        id="plural"
        class="input"
        bind:value={card.plural}
        placeholder="Häuser"
        autocapitalize="off"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        lang="de"
      />
    </div>
  {:else if card.pos === 'verb'}
    <div class="field">
      <label for="praet">Präteritum</label>
      <input id="praet" class="input" bind:value={card.praeteritum} placeholder="ging" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" lang="de" />
    </div>
    <div class="field">
      <label for="p2">Partizip II</label>
      <input id="p2" class="input" bind:value={card.partizip2} placeholder="gegangen" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" lang="de" />
    </div>
    <div class="field">
      <span class="label">{t('words.editor.perfektWith')}</span>
      <div class="segmented">
        <button type="button" class:active={card.auxiliary === 'haben'} onclick={() => (card.auxiliary = card.auxiliary === 'haben' ? '' : 'haben')}>haben</button>
        <button type="button" class:active={card.auxiliary === 'sein'} onclick={() => (card.auxiliary = card.auxiliary === 'sein' ? '' : 'sein')}>sein</button>
      </div>
    </div>
  {/if}
  {#if card.pos === 'verb' || card.preps?.trim()}
    <!-- Verbs, and any word that has prepositions already (stolz auf + Akk). -->
    <div class="field">
      <label for="preps">{t('words.editor.prepositions')} <span class="hint">{t('words.editor.prepositionsHint')}</span></label>
      <input id="preps" class="input" bind:value={card.preps} placeholder="auf + Akk" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" lang="de" />
    </div>
  {/if}

  <div class="field">
    <label for="tr">{t('words.editor.translation')}</label>
    <input
      id="tr"
      class="input"
      bind:this={translationEl}
      bind:value={card.translation}
      placeholder={t('words.editor.translationIn', { lang })}
      lang={settings.lang}
    />
    {#if draft.showMeanings}<MeaningChips {draft} />{/if}
  </div>

  <div class="field">
    <span class="label">{t('words.editor.examples')}</span>
    {#if card.examples.length}
      <div class="list examples">
        {#each card.examples as ex, i}
          <div class="example" transition:slide={{ duration: dur(180) }}>
            <div class="grow stack-sm">
              <textarea
                class="input ex-de"
                rows="2"
                bind:value={ex.de}
                placeholder={t('words.editor.germanSentence')}
                autocapitalize="sentences"
                autocomplete="off"
                {...{ autocorrect: 'off' }}
                spellcheck="false"
                lang="de"
              ></textarea>
              <input class="input" bind:value={ex.tr} placeholder={t('words.editor.translationIn', { lang })} lang={settings.lang} />
            </div>
            <div class="ex-actions">
              <SpeakButton text={ex.de} />
              <button type="button" class="icon-btn del" aria-label={t('words.editor.deleteExample')} onclick={() => card.examples.splice(i, 1)}>
                <Icon name="trash" size={20} />
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
    <button type="button" class="btn btn-ghost add-ex" onclick={addExample}><Icon name="plus" size={18} /> {t('words.editor.addExample')}</button>
  </div>

  <div class="field">
    <label for="notes">{t('words.editor.notes')}</label>
    <textarea
      id="notes"
      class="input"
      rows="3"
      bind:this={notesEl}
      bind:value={card.notes}
      placeholder={draft.hard ? t('words.editor.hookPlaceholder', { word: card.term }) : t('words.editor.notesPlaceholder')}
    ></textarea>
  </div>

  <div class="stack buttons">
    {#if draft.isNew}
      <button type="submit" class="btn btn-primary btn-block btn-lg"><Icon name="check" /> {t('common.add')}</button>
      <button type="button" class="btn btn-block" onclick={onaddclose}>{t('words.editor.addAndClose')}</button>
    {:else}
      <button type="submit" class="btn btn-primary btn-block btn-lg"><Icon name="check" /> {t('common.save')}</button>
      <button type="button" class="btn btn-danger btn-block" onclick={onremove}><Icon name="trash" /> {t('words.editor.deleteWord')}</button>
    {/if}
  </div>
</form>

<style>
  .grow {
    flex: 1;
    min-width: 0;
  }
  .hint {
    font-weight: 400;
  }
  .genders {
    display: flex;
    gap: 8px;
  }
  .gender {
    flex: 1;
    min-height: 48px;
    border-radius: 14px;
    border: 0;
    background: color-mix(in srgb, currentColor 10%, var(--surface));
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, currentColor 30%, transparent);
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 900;
    cursor: pointer;
    opacity: 0.6;
    transition:
      opacity var(--dur-fast) var(--ease),
      background-color var(--dur-fast) var(--ease);
  }
  .gender.active {
    opacity: 1;
  }
  .gender.g-m.active,
  .gender.g-f.active,
  .gender.g-n.active {
    color: var(--on-tone);
    box-shadow: none;
  }
  .gender.g-m.active {
    background: var(--der);
  }
  .gender.g-f.active {
    background: var(--die);
  }
  .gender.g-n.active {
    background: var(--das);
  }
  .examples {
    padding: 0;
  }
  .example {
    display: flex;
    gap: 4px;
    padding: 10px 4px 10px 10px;
  }
  .example + .example {
    border-top: 1px solid var(--hairline);
  }
  .stack-sm {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ex-de {
    min-height: 0;
  }
  .ex-actions {
    display: flex;
    flex-direction: column;
  }
  .del {
    color: var(--bad);
  }
  .add-ex {
    align-self: flex-start;
  }
  .buttons {
    margin-top: 8px;
  }
</style>
