<script lang="ts">
  import { onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import GermanField from '../components/words/GermanField.svelte';
  import CardDetailsForm from '../components/words/CardDetailsForm.svelte';
  import QuickAdd from '../components/words/QuickAdd.svelte';
  import { back, route } from '../lib/router.svelte';
  import { dur } from '../lib/motion';
  import { deleteCard } from '../lib/db/repo';
  import { setKnown, setPaused, STATUS_LABELS } from '../lib/progress';
  import { showToast, undoToast } from '../lib/ui/dialogs.svelte';
  import { t } from '../lib/i18n.svelte';
  import { CardDraft } from '../lib/words/cardDraft.svelte';

  /*
   * New word  → "Quick add" (components/words/QuickAdd): type → dictionary preview → ✓ Add
   *             (keyboard stays up for the next word). "Edit details" slides the full form open.
   * Edit word → the full form, a status row (Pause / Mark known / Not learned) and Delete with Undo.
   */
  const isNew = route.parts[1] === 'new';
  const cardId = isNew ? 0 : Number(route.parts[1]);
  const setId = Number(route.query.get('set')) || 0;

  /** A word passed in (#/card/new?set=…&term=…, e.g. shared from another app): filled in and looked up. */
  const givenTerm = isNew ? (route.query.get('term') ?? '').trim() : '';

  /** New words: made by QuickAdd. Editing: the card being edited. */
  let draft = $state<CardDraft | undefined>(isNew ? undefined : new CardDraft({ isNew: false, cardId }));
  let form = $state<CardDetailsForm>();

  const card = $derived(draft?.card);
  const backTo = $derived(card?.setId ? `/set/${card.setId}` : setId ? `/set/${setId}` : '/');

  onDestroy(() => {
    if (!isNew) draft?.destroy();
  });

  async function saveAndClose() {
    if (draft && (await draft.save())) back(backTo);
  }

  async function changeStatus(known: boolean) {
    if (!draft?.card.id) return;
    await setKnown([draft.card.id], known);
    draft.card.known = known ? 1 : 0;
    draft.status = known ? 'known' : 'new';
    showToast(known ? t('words.editor.markedKnown') : t('words.editor.backToLearning'));
  }

  /** Pause / bring back: the word stays as it is, only sessions leave it out while paused. */
  async function togglePause() {
    if (!draft?.card.id) return;
    const pause = !draft.card.paused;
    const at = Date.now();
    await setPaused([draft.card.id], pause, at);
    draft.card.paused = pause ? at : 0;
    showToast(t(pause ? 'words.editor.pausedToast' : 'words.editor.resumedToast'));
  }

  async function remove() {
    if (!draft?.card.id) return;
    const term = draft.card.term;
    const snapshot = await deleteCard(draft.card.id);
    back(backTo);
    undoToast(t('words.editor.deleted', { word: term }), snapshot);
  }
</script>

<div class="page">
  <Header title={isNew ? t('words.editor.titleNew') : t('words.editor.titleEdit')} subtitle={draft?.setName ?? ''} {backTo}>
    {#snippet actions()}
      {#if draft && card && draft.loaded && !draft.missing}
        <button
          class="icon-btn star"
          class:on={card.starred}
          aria-label={card.starred ? t('words.editor.unstar') : t('words.editor.star')}
          aria-pressed={!!card.starred}
          onpointerdown={draft.keepFocus}
          onclick={() => (card.starred = card.starred ? 0 : 1)}
        >
          <Icon name="star" filled={!!card.starred} />
        </button>
      {/if}
    {/snippet}
  </Header>

  {#if isNew}
    <QuickAdd {setId} term={givenTerm} autofocus showAdded bind:draft onclose={() => back(backTo)} />
  {:else if draft?.missing}
    <div class="empty">{t('words.editor.gone')}</div>
  {:else if !draft?.loaded || !card}
    <div class="card"><Skeleton lines={4} /></div>
  {:else}
    <div class="stack">
      <GermanField {draft} />

      <!-- ---------- Status ---------- -->
      <div class="card status-row">
        <span class="pill st-{draft.status}">{STATUS_LABELS[draft.status]}</span>
        {#if card.paused}<span class="pill paused"><Icon name="pause" size={14} /> {t('words.editor.paused')}</span>{/if}
        <span class="spacer"></span>
        {#if draft.status !== 'known'}
          <button type="button" class="btn small-btn" onclick={togglePause}>
            {#if card.paused}<Icon name="play" size={16} filled /> {t('words.editor.resume')}{:else}<Icon name="pause" size={18} /> {t('words.editor.pause')}{/if}
          </button>
        {/if}
        {#if draft.status !== 'known'}
          <button type="button" class="btn small-btn" onclick={() => changeStatus(true)}><Icon name="check" size={18} /> {t('words.editor.markKnown')}</button>
        {/if}
        {#if draft.status !== 'new'}
          <button type="button" class="btn small-btn" onclick={() => changeStatus(false)}><Icon name="refresh" size={18} /> {t('words.editor.notLearned')}</button>
        {/if}
      </div>
      {#if draft.hard}
        <div class="card hard-banner" in:fade={{ duration: dur(150) }}>
          <div class="row hard-head"><Icon name="flame" size={20} filled /> {t('words.editor.missed', { n: draft.misses })}</div>
          <p class="small">
            {t('words.editor.hookHint')}
          </p>
          <div class="row hard-actions">
            <button type="button" class="btn small-btn" onclick={() => form?.writeHook('note')}><Icon name="edit" size={18} /> {t('words.editor.writeNote')}</button>
            <button type="button" class="btn small-btn" onclick={() => form?.writeHook('example')}><Icon name="plus" size={18} /> {t('words.editor.ownExample')}</button>
          </div>
        </div>
      {/if}

      <!-- ---------- Full form ---------- -->
      <CardDetailsForm bind:this={form} {draft} onsubmit={() => void saveAndClose()} onremove={() => void remove()} />
    </div>
  {/if}
</div>

<style>
  /* ---------- Status ---------- */
  .hard-banner {
    background: color-mix(in srgb, var(--warn) 8%, var(--surface));
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--warn) 45%, transparent);
  }
  .hard-head {
    color: var(--warn);
    font-family: var(--font-display);
    font-weight: 800;
  }
  .hard-banner p {
    margin: 6px 0 10px;
    color: var(--muted);
  }
  .hard-actions {
    flex-wrap: wrap;
  }
  .status-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px 12px;
  }
  .pill {
    padding: 4px 12px;
    border-radius: 999px;
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 800;
    background: var(--surface-2);
  }
  .pill.st-learning {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .pill.paused {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 13%, transparent);
  }
  .pill.st-learned,
  .pill.st-known {
    color: var(--good);
    background: color-mix(in srgb, var(--good) 14%, transparent);
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
</style>
