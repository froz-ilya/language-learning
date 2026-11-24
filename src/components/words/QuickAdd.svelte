<script lang="ts" module>
  import type { PickedFrom } from '../../lib/words/cardDraft.svelte';

  /** What the panel keeps when the page is left and opened again (see SetPage). */
  export interface QuickAddDraft {
    term: string;
    pickedFrom: PickedFrom | null;
  }
</script>

<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { fade, fly, slide } from 'svelte/transition';
  import Icon from '../Icon.svelte';
  import Term from '../Term.svelte';
  import SpeakButton from '../SpeakButton.svelte';
  import Skeleton from '../Skeleton.svelte';
  import ArticleChoices from '../ArticleChoices.svelte';
  import ReadingSwitch from '../ReadingSwitch.svelte';
  import GermanField from './GermanField.svelte';
  import CardDetailsForm from './CardDetailsForm.svelte';
  import MeaningChips from './MeaningChips.svelte';
  import SuggestionRow from './SuggestionRow.svelte';
  import { go } from '../../lib/router.svelte';
  import { dur } from '../../lib/motion';
  import { settings } from '../../lib/settings.svelte';
  import { fmtNumber, i18n, t, tParts } from '../../lib/i18n.svelte';
  import { displayTerm, speakableTerm } from '../../lib/german/articles';
  import { formatPrep } from '../../lib/german/prepositions';
  import { PROVIDER_LABELS } from '../../lib/sources/chain';
  import { CardDraft, type SetCard } from '../../lib/words/cardDraft.svelte';
  import type { ArticleVariant, Card } from '../../lib/types';

  /**
   * "Quick add": type → dictionary preview → ✓ Add (keyboard stays up for the next word).
   * "Edit details" slides the full form open. Used on the set page and on /card/new.
   */
  let {
    setId,
    term = '',
    initial,
    autofocus = false,
    showAdded = false,
    star = false,
    cards,
    draft = $bindable(),
    onadded,
    onopen = (id: number) => go(`/card/${id}`),
    onclose,
    ondraft,
  }: {
    setId: number;
    /** A word passed in (#/card/new?…&term=…, e.g. shared from another app): filled in and looked up. */
    term?: string;
    /** A word restored from before (not looked up again). */
    initial?: QuickAddDraft | null;
    autofocus?: boolean;
    /** List the words added here under "Added". */
    showAdded?: boolean;
    /** A star toggle in the preview (where the page header has none). */
    star?: boolean;
    /** The set's cards, when the page has them live (else they're loaded once). */
    cards?: SetCard[];
    draft?: CardDraft;
    onadded?: (card: Card) => void;
    onopen?: (id: number) => void;
    /** "Add and close". */
    onclose?: () => void;
    /** The typed word changed (to keep it while the page is left). */
    ondraft?: (d: QuickAddDraft) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  const d = new CardDraft({ isNew: true, setId, term: term.trim() || initial?.term || '' });
  // svelte-ignore state_referenced_locally
  if (!term.trim() && initial?.pickedFrom) d.pickedFrom = initial.pickedFrom;
  draft = d;
  let form = $state<CardDetailsForm>();

  /** Words added since this panel opened, newest first. */
  type AddedWord = SetCard & { id: number; translation: string };
  let added = $state.raw<AddedWord[]>([]);

  $effect(() => {
    if (cards) d.setCards = cards;
  });

  $effect(() => {
    const state = { term: d.card.term, pickedFrom: d.pickedFrom };
    ondraft?.(state);
  });

  onDestroy(() => d.destroy());

  /**
   * Save, list it under "Added", and get ready for the next word — keeping the keyboard up.
   * "denken an" while the set has "denken": the preposition goes to that card.
   */
  async function quickAdd() {
    d.focusField(); // inside the tap, so iOS keeps the keyboard open
    const saved = d.mergeTarget ? await d.mergePrepIntoDuplicate() : await d.save();
    if (!saved) return;
    added = [
      {
        id: saved.id!,
        term: saved.term.trim(),
        pos: saved.pos,
        genders: saved.pos === 'noun' ? saved.genders : [],
        translation: saved.translation.trim(),
      },
      ...added,
    ];
    onadded?.(saved);
    await d.resetForNext();
    d.focusField();
    if (showAdded) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function addAndClose() {
    const saved = await d.save();
    if (!saved) return;
    onadded?.(saved);
    if (onclose) onclose();
    else await d.resetForNext();
  }

  /** Quick add of one article straight from its row. */
  async function addArticle(a: ArticleVariant) {
    d.chooseArticle(a);
    await quickAdd();
  }

  async function openDetails(focusTranslation = false) {
    d.showDetails = true;
    if (focusTranslation) {
      await tick();
      await form?.focusTranslation();
    }
  }

  // A word passed in: look it up right away.
  // svelte-ignore state_referenced_locally
  if (term.trim()) void d.runLookup();

  const lookupState = $derived(d.lookupState);
  const card = $derived(d.card);
</script>

<div class="stack quick">
  <GermanField draft={d} {autofocus} onadd={() => void quickAdd()} />

  {#if lookupState === 'loading'}
    <div class="card" in:fade={{ duration: dur(150) }}>
      <Skeleton lines={3} />
    </div>
  {:else if lookupState === 'done' || (d.showDetails && card.term.trim() && !d.cyrillic)}
    <div class="card preview" in:fly={{ y: 10, duration: dur(220) }}>
      <div class="p-top">
        <div class="p-term"><Term {card} /></div>
        <SpeakButton text={speakableTerm(card)} />
        {#if star}
          <button
            type="button"
            class="icon-btn star"
            class:on={card.starred}
            aria-label={card.starred ? t('words.editor.unstar') : t('words.editor.star')}
            aria-pressed={!!card.starred}
            onpointerdown={d.keepFocus}
            onclick={() => (card.starred = card.starred ? 0 : 1)}
          >
            <Icon name="star" filled={!!card.starred} />
          </button>
        {/if}
      </div>
      {#if d.reflexive && lookupState === 'done'}
        <ReadingSwitch
          options={d.reflexiveOptions}
          selected={d.reflexiveOn ? 'sich' : 'plain'}
          onpick={(id) => d.chooseReflexive(id === 'sich')}
          onpointerdown={d.keepFocus}
        />
      {/if}
      {#if d.prepOptions.length > 1 && lookupState === 'done'}
        <ReadingSwitch
          options={d.prepOptions}
          selected={d.prepOn ?? ''}
          onpick={(id) => d.choosePrep(id || null)}
          onpointerdown={d.keepFocus}
        />
      {/if}
      {#if d.needsCase && d.caseWord}
        <div class="case-pick">
          <span class="small muted" lang={i18n.lang}>{t('words.editor.pickCase', { prep: d.caseWord })}</span>
          <div class="segmented" role="group" aria-label={t('words.editor.pickCase', { prep: d.caseWord })}>
            {#each ['Akk', 'Dat'] as const as c}
              <button type="button" lang="de" onpointerdown={d.keepFocus} onclick={() => d.pickCase(c)}>{c}</button>
            {/each}
          </div>
        </div>
      {/if}
      {#if d.articles.length > 1 && lookupState === 'done'}
        <div class="article-pick">
          <ArticleChoices
            term={card.term}
            articles={d.articles}
            selected={d.pickedArticle}
            trLang={settings.lang}
            onpick={d.chooseArticle}
            onadd={(a) => void addArticle(a)}
            isAdded={d.articleInSet}
            onpointerdown={d.keepFocus}
          />
          <div class="small muted">{t('words.editor.articlesQuick')}</div>
        </div>
      {:else}
        {#if d.forms}<div class="p-forms">{d.forms}</div>{/if}
        {#if d.prepsLine}<div class="p-preps small" lang="de">{d.prepsLine}</div>{/if}
        {#if d.showMeanings && !d.showDetails}
          <!-- The meaning tiles below are the translation: no line repeating them. -->
        {:else if card.translation}
          <div class="p-tr">{card.translation}</div>
        {:else}
          <div class="p-tr muted">{t('words.editor.noTranslationYet')}</div>
        {/if}
      {/if}
      {#if d.showMeanings && !d.showDetails}<MeaningChips draft={d} />{/if}
      {#if d.firstExample}
        <div class="p-ex">
          {#key d.exampleSwap}
            <div in:fade={{ duration: dur(180) }}>
              <div lang="de">{d.firstExample.de}</div>
              {#if d.firstExample.tr}<div class="muted" lang={settings.lang}>{d.firstExample.tr}</div>{/if}
            </div>
          {/key}
          {#if d.canCycle}
            <button type="button" class="another" onpointerdown={d.keepFocus} onclick={() => d.anotherExample()}>
              <Icon name="refresh" size={14} /> {t('words.editor.anotherExample')}
            </button>
          {/if}
        </div>
      {/if}
      {#if d.phrases.length}
        <ul class="p-phrases" aria-label={t('words.editor.phrases')}>
          {#each d.phrases as p}
            <li>
              <span class="ph-de" lang="de">{p.de}</span>
              {#if p.tr}<span class="muted">— <span lang={settings.lang}>{p.tr}</span></span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
      {#if d.lemmaNote || d.via}
        <div class="row">
          {#if d.lemmaNote}<span class="chip">{d.lemmaNote}</span>{/if}
          {#if d.via}<span class="via muted">{t('words.editor.via', { name: PROVIDER_LABELS[d.via] })}</span>{/if}
        </div>
      {/if}
    </div>
  {:else if lookupState === 'notfound' || lookupState === 'error' || lookupState === 'offline'}
    <div class="card note" in:fade={{ duration: dur(150) }}>
      <Icon name={lookupState === 'offline' ? 'refresh' : 'search'} size={20} />
      <div class="small">
        {#if lookupState === 'notfound'}
          {t('words.editor.notFound', { word: card.term.trim() })}
        {:else if lookupState === 'error'}
          {t('words.editor.noAnswer')}
        {:else}
          {t('words.editor.offline', { word: card.term.trim() })}
        {/if}
      </div>
    </div>
    {#if d.englishRows.length}
      <!-- A Latin word the dictionary doesn't know may be English: the German words it means. -->
      <div class="stack-sm" transition:slide={{ duration: dur(180) }}>
        <div class="small muted from-en" lang={i18n.lang}>{t('words.editor.fromEnglishPick', { word: card.term.trim() })}</div>
        <div class="list" role="listbox">
          {#each d.englishRows as r}
            <SuggestionRow row={r} hintLang="en" stacked inSet={d.rowInSet(r)} onpointerdown={d.keepFocus} onclick={() => d.pick(r, 'en')} />
          {/each}
        </div>
      </div>
    {/if}
  {:else if !card.term.trim()}
    <div class="hint-card small muted" in:fade={{ duration: dur(150) }}>
      {#if added.length}
        {t('words.editor.nextWord')}
      {:else}
        {t('words.editor.hintAny')}
      {/if}
    </div>
  {/if}

  {#if d.duplicate}
    {@const dup = d.duplicate}
    <div class="stack quick-actions" in:fade={{ duration: dur(150) }}>
      <div class="card note dup">
        <Icon name="check" size={20} />
        <div class="grow">
          {#each tParts('words.editor.inSet') as p}{#if p.slot}<span lang="de"><Term card={dup} /></span>{:else}{p.text}{/if}{/each}
        </div>
        <button type="button" class="btn small-btn" onclick={() => onopen(dup.id!)}>{t('words.editor.open')}</button>
      </div>
      {#if d.mergeTarget && d.noteEntry && !d.showDetails}
        {@const entry = d.noteEntry}
        <!-- "denken an" while the set has "denken": the preposition goes to that word. -->
        <button type="button" class="btn btn-primary btn-lg btn-block add" onpointerdown={d.keepFocus} onclick={() => quickAdd()}>
          <Icon name="check" size={22} />
          {t('words.editor.addPrepTo', { prep: formatPrep(entry), word: dup.term })}
        </button>
      {/if}
      {#if lookupState === 'idle' && !d.showDetails && !d.mergeTarget}
        <!-- Only the typed text matched: the dictionary may know another article (die See). -->
        <button type="button" class="btn btn-ghost btn-block" onpointerdown={d.keepFocus} onclick={() => d.runLookup()}>
          <Icon name="search" size={18} /> {t('words.lookUp')}
        </button>
      {/if}
    </div>
  {:else if !d.showDetails && lookupState !== 'loading' && card.term.trim()}
    <div class="stack quick-actions" in:fade={{ duration: dur(150) }}>
      {#if lookupState === 'idle'}
        <button type="button" class="btn btn-primary btn-lg btn-block" onpointerdown={d.keepFocus} onclick={() => d.runLookup()}>
          <Icon name="search" size={20} /> {t('words.lookUp')}
        </button>
        {#if !d.cyrillic}
          <button type="button" class="btn btn-ghost btn-block" onclick={() => openDetails()}>{t('words.editor.fillIn')}</button>
        {/if}
      {:else}
        {#if lookupState === 'error'}
          <button type="button" class="btn btn-block" onpointerdown={d.keepFocus} onclick={() => d.runLookup()}
            ><Icon name="refresh" size={20} /> {t('common.retry')}</button
          >
        {/if}
        <button type="button" class="btn btn-primary btn-lg btn-block add" onpointerdown={d.keepFocus} onclick={() => quickAdd()}>
          <Icon name="check" size={22} />
          {lookupState === 'done'
            ? d.articles.length > 1 && d.pickedArticle
              ? t('words.addWord', { word: displayTerm(card) })
              : t('common.add')
            : t('words.editor.addAnyway')}
        </button>
        <button type="button" class="btn btn-ghost btn-block" onclick={() => openDetails(lookupState === 'notfound')}>
          <Icon name="edit" size={18} />
          {lookupState === 'notfound' ? t('words.editor.addTranslation') : t('words.editor.editDetails')}
        </button>
      {/if}
    </div>
  {/if}

  {#if d.showDetails}
    <CardDetailsForm bind:this={form} draft={d} onsubmit={() => void quickAdd()} onaddclose={() => void addAndClose()} />
  {/if}

  {#if showAdded && added.length}
    <section class="added" transition:slide={{ duration: dur(200) }}>
      <h2 class="section-title">{t('words.editor.added')} <span>{fmtNumber(added.length)}</span></h2>
      <div class="list" role="list">
        {#each added as w (w.id)}
          <div class="list-item" role="listitem" in:slide={{ duration: dur(220) }}>
            <span class="title" lang="de"><Term card={w} /></span>
            {#if w.translation}<span class="sub ellipsis" lang={settings.lang}>{w.translation}</span>{/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .grow {
    flex: 1;
    min-width: 0;
  }
  .ellipsis {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .preview {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 18px 12px 18px 18px;
    border-radius: var(--radius-lg);
    background: var(--grad-feature);
  }
  .p-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .p-term {
    flex: 1;
    min-width: 0;
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 800;
    overflow-wrap: anywhere;
    line-height: 1.2;
  }
  .p-forms {
    color: var(--muted);
  }
  .case-pick {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
  }
  .case-pick .segmented button {
    min-height: 34px;
    padding: 4px 16px;
  }
  .p-preps {
    color: var(--muted);
    font-weight: 600;
  }
  .p-tr {
    font-size: 19px;
    color: var(--text-2);
    overflow-wrap: break-word;
  }
  .p-ex {
    display: flex;
    flex-direction: column;
    margin-top: 6px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--inset-bg);
    box-shadow: inset 0 0 0 1px var(--hairline);
    font-family: var(--font-read);
    font-style: italic;
    font-size: 16px;
  }
  .another {
    display: inline-flex;
    align-items: center;
    align-self: flex-end;
    gap: 5px;
    min-height: 34px;
    margin: 4px -6px -6px auto;
    padding: 4px 8px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--accent);
    font-family: var(--font-display);
    font-style: normal;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    transition: background-color var(--dur-fast) var(--ease);
  }
  .another:active {
    background: var(--accent-soft);
  }
  .p-phrases {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin: 2px 0 0;
    padding: 0 2px;
    list-style: none;
    font-size: 15px;
    overflow-wrap: break-word;
  }
  .ph-de {
    font-weight: 700;
  }
  .note {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .note > :global(svg) {
    color: var(--muted);
    flex-shrink: 0;
    margin-top: 1px;
  }
  .dup {
    align-items: center;
  }
  .dup > :global(svg) {
    color: var(--good);
    margin-top: 0;
  }
  .dup .grow {
    overflow-wrap: anywhere;
  }
  .stack-sm {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .from-en {
    margin: 0 4px;
  }
  .added .list-item {
    min-height: 48px;
    padding: 8px 16px;
    cursor: default;
  }
  .added .list-item:active {
    background: none;
  }
  .added .title {
    flex-shrink: 0;
    max-width: 60%;
    overflow-wrap: anywhere;
  }
  .added .ellipsis {
    text-align: right;
  }
  .hint-card {
    padding: 4px 6px;
    text-align: center;
  }
  .add {
    font-size: 20px;
  }
  .small-btn {
    min-height: 38px;
    padding: 6px 12px;
    font-size: 15px;
  }
  .star {
    color: var(--muted);
  }
  .star.on {
    color: var(--accent);
  }
  .via {
    font-size: 12px;
  }
  .article-pick {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 4px 0 2px;
  }
</style>
