<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fly, slide } from 'svelte/transition';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Term from '../components/Term.svelte';
  import SpeakButton from '../components/SpeakButton.svelte';
  import ProgressBar from '../components/ProgressBar.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import SwipeRow from '../components/SwipeRow.svelte';
  import FillProgress from '../components/library/FillProgress.svelte';
  import EmptyState from '../components/library/EmptyState.svelte';
  import { afterSheet, learnedLine, plural, setKnownWithUndo, stagger } from '../components/library/actions';
  import { go, replace, route } from '../lib/router.svelte';
  import { live } from '../lib/live.svelte';
  import { dur } from '../lib/motion';
  import { online } from '../lib/online.svelte';
  import { db } from '../lib/db/schema';
  import { allFolders, cardsInSet, deleteCard, deleteSet, toggleStar, updateSet } from '../lib/db/repo';
  import { isHard, progressOf, reviewsFor, setKnown, statusOf, STATUS_LABELS, type WordStatus } from '../lib/progress';
  import { displayPlural, displayVerbForms, speakableTerm } from '../lib/german/articles';
  import { cancelFill, fillJob, fillSet } from '../lib/fill/runner.svelte';
  import { chooseAction, confirmAction, promptText, showToast, undoToast, type ActionItem } from '../lib/ui/dialogs.svelte';
  import type { Card } from '../lib/types';

  const id = Number(route.parts[1]);

  const data = live(async () => {
    const set = await db.sets.get(id);
    const [cards, folders] = await Promise.all([cardsInSet(id), allFolders()]);
    cards.sort((a, b) => a.createdAt - b.createdAt || a.id! - b.id!);
    const reviews = await reviewsFor(cards);
    const status = new Map(cards.map((c) => [c.id!, statusOf(c, reviews.get(c.id!))]));
    const hard = new Set(cards.filter((c) => isHard(c, reviews.get(c.id!))).map((c) => c.id!));
    return { set, cards, folders, status, hard, progress: progressOf(cards, reviews) };
  });

  const set = $derived(data.value?.set);
  const cards = $derived(data.value?.cards ?? []);
  const isPreset = $derived(!!set?.level);
  const folder = $derived(set?.folderId ? data.value?.folders.find((f) => f.id === set.folderId) : undefined);
  const needFill = $derived(cards.filter((c) => c.needsFill));
  const statusOfCard = (c: Card): WordStatus => data.value?.status.get(c.id!) ?? 'new';

  // ---------- Filter + search ----------

  type Filter = 'all' | WordStatus;
  const FILTERS: Filter[] = ['all', 'new', 'learning', 'learned', 'known'];
  let filter = $state<Filter>('all');
  let query = $state('');

  const countOf = (f: Filter) => (f === 'all' ? cards.length : (data.value?.progress[f] ?? 0));

  const visible = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return cards.filter(
      (c) =>
        (filter === 'all' || statusOfCard(c) === filter) &&
        (!q ||
          c.term.toLowerCase().includes(q) ||
          c.translation.toLowerCase().includes(q) ||
          c.plural.toLowerCase().includes(q)),
    );
  });

  const title = $derived(set ? set.topic || set.name : '');
  const subtitle = $derived(
    [plural(cards.length, 'word'), set?.level ? `Level ${set.level}` : folder?.name].filter(Boolean).join(' · '),
  );
  const backTo = $derived(set?.level ? `/level/${set.level}` : set?.folderId ? `/folder/${set.folderId}` : '/library');

  // ---------- Fill missing details ----------

  // Runs in the app-wide background queue, so leaving the page doesn't stop it.
  const filling = $derived(fillJob(id));
  const FILL_LABEL = {
    running: 'Filling in details…',
    queued: 'Waiting for another set to finish…',
    paused: 'Offline — continues when you’re back online',
  } as const;

  function fillNow() {
    if (filling || !needFill.length) return;
    void fillSet(id);
  }

  // ---------- Word actions ----------

  async function removeWord(c: Card) {
    undoToast(`Deleted “${c.term}”`, await deleteCard(c.id!));
  }

  async function toggleKnown(c: Card) {
    const known = statusOfCard(c) !== 'known';
    await setKnown([c.id!], known);
    showToast(known ? `“${c.term}” marked as known` : `“${c.term}” is back to learning`);
  }

  function secondLine(c: Card): string {
    if (c.pos === 'noun') return displayPlural(c);
    if (c.pos === 'verb') return displayVerbForms(c);
    return '';
  }

  // ---------- Set menu ----------

  async function rename() {
    const name = await promptText({ title: 'Rename set', value: set?.name ?? '', confirmLabel: 'Save' });
    if (name) await updateSet(id, { name });
  }

  async function moveToFolder() {
    const folders = data.value?.folders ?? [];
    const items: ActionItem[] = folders
      .filter((f) => f.id !== set?.folderId)
      .map((f) => ({
        label: f.name,
        icon: 'folder',
        run: async () => {
          await updateSet(id, { folderId: f.id! });
          showToast(`Moved to “${f.name}”`);
        },
      }));
    if (set?.folderId)
      items.push({
        label: 'Remove from folder',
        icon: 'x',
        run: async () => {
          await updateSet(id, { folderId: 0 });
          showToast('Moved out of the folder');
        },
      });
    if (!items.length) {
      showToast('No folders yet — create one in the Library.');
      return;
    }
    await chooseAction('Move to folder', items);
  }

  async function markAll(known: boolean) {
    const ok = await confirmAction(
      known
        ? {
            title: 'Mark all words as known?',
            message: 'They count as learned and are skipped in sessions.',
            confirmLabel: 'Mark as known',
          }
        : {
            title: 'Reset progress?',
            message: 'Every word in this set goes back to “New”.',
            confirmLabel: 'Reset',
            destructive: true,
          },
    );
    if (ok) await setKnownWithUndo(cards.map((c) => c.id!), known, known ? 'All marked as known' : 'Progress reset');
  }

  async function removeSet() {
    const name = set?.name ?? 'Set';
    const snapshot = await deleteSet(id);
    replace(backTo);
    undoToast(`Deleted “${name}”`, snapshot);
  }

  function menu() {
    if (!set) return;
    const items: ActionItem[] = [];
    if (!isPreset) {
      items.push({ label: 'Rename', icon: 'edit', run: () => void afterSheet(rename) });
      items.push({ label: 'Move to folder', icon: 'folder', run: () => void afterSheet(moveToFolder) });
    }
    items.push({ label: 'Import words', icon: 'import', run: () => go('/import', { set: id }) });
    if (cards.length) {
      items.push({ label: 'Mark all as known', icon: 'check', run: () => void afterSheet(() => markAll(true)) });
      items.push({ label: 'Reset progress', icon: 'refresh', run: () => void afterSheet(() => markAll(false)) });
    }
    if (!isPreset) items.push({ label: 'Delete set', icon: 'trash', destructive: true, run: removeSet });
    return chooseAction(title, items);
  }
</script>

<div class="page">
  {#if data.value && !set}
    <Header title="Set" backTo="/library" />
    <EmptyState icon="cards" title="This set is gone" text="It may have been deleted.">
      <button class="btn btn-primary btn-block" onclick={() => go('/library')}>Back to Library</button>
    </EmptyState>
  {:else}
    <Header {title} {subtitle} {backTo}>
      {#snippet actions()}
        {#if set}
          <button class="icon-btn" aria-label="Add word" onclick={() => go('/card/new', { set: id })}><Icon name="plus" /></button>
          <button class="icon-btn" aria-label="Set actions" onclick={menu}><Icon name="more" /></button>
        {/if}
      {/snippet}
    </Header>

    {#if !data.value}
      <div class="card"><Skeleton lines={6} /></div>
    {:else}
      <div class="stack">
        {#if cards.length}
          <div class="progress card">
            <div class="row small">
              <span class="muted">{learnedLine(data.value.progress)}</span>
              <span class="spacer"></span>
              <span class="pct">{Math.round(data.value.progress.ratio * 100)}%</span>
            </div>
            <ProgressBar progress={data.value.progress} />
          </div>

          <button class="btn btn-primary btn-block btn-lg" onclick={() => go(`/learn/set/${id}`)}>
            <Icon name="play" filled size={18} /> Learn
          </button>
          <div class="row">
            <button class="btn grow" onclick={() => go(`/modes/set/${id}`)}><Icon name="cards" size={20} /> More ways</button>
            <button class="btn grow" onclick={() => go('/card/new', { set: id })}><Icon name="plus" size={20} /> Add word</button>
          </div>
        {/if}

        {#if filling}
          <div transition:slide={{ duration: dur(200) }}>
            <FillProgress done={filling.done} total={filling.total} label={FILL_LABEL[filling.status]} oncancel={() => cancelFill(id)} />
          </div>
        {:else if needFill.length}
          <div class="card banner" transition:slide={{ duration: dur(200) }}>
            <Icon name="sparkle" />
            <div class="grow small">
              <strong>{needFill.length} {needFill.length === 1 ? 'word needs' : 'words need'} details</strong>
              <div class="muted">
                {online.value ? 'Articles, plurals, verb forms, translations & examples.' : 'Connect to the internet to fill them in.'}
              </div>
            </div>
            <button class="btn btn-primary" disabled={!online.value} onclick={fillNow}>Fill now</button>
          </div>
        {/if}
      </div>

      {#if !cards.length}
        <div class="section">
          <EmptyState icon="plus" title="No words yet" text="Add your first word — we’ll fill in the article, plural and translation for you.">
            <button class="btn btn-primary btn-lg btn-block" onclick={() => go('/card/new', { set: id })}><Icon name="plus" /> Add a word</button>
            <button class="btn btn-block" onclick={() => go('/import', { set: id })}><Icon name="import" /> Import a list</button>
          </EmptyState>
        </div>
      {:else}
        <section class="section">
          <div class="chips" role="tablist" aria-label="Filter by status">
            {#each FILTERS as f}
              {@const n = countOf(f)}
              <button
                class="fchip"
                class:active={filter === f}
                role="tab"
                aria-selected={filter === f}
                disabled={!n && filter !== f}
                onclick={() => (filter = f)}
              >
                {#if f !== 'all'}<span class="dot st-{f}"></span>{/if}
                {f === 'all' ? 'All' : STATUS_LABELS[f]}
                <span class="n">{n}</span>
              </button>
            {/each}
          </div>

          {#if cards.length > 10}
            <div class="search">
              <span class="muted"><Icon name="search" size={18} /></span>
              <input
                class="input"
                type="search"
                placeholder="Search {cards.length} words"
                bind:value={query}
                autocapitalize="off"
                autocomplete="off"
                spellcheck="false"
              />
            </div>
          {/if}

          {#if !visible.length}
            <div class="empty">
              {query.trim() ? `No words match “${query.trim()}”.` : `No ${STATUS_LABELS[filter as WordStatus]?.toLowerCase() ?? ''} words.`}
            </div>
          {:else}
            <div class="words">
              {#each visible as c, i (c.id)}
                {@const st = statusOfCard(c)}
                <div
                  class="w"
                  animate:flip={{ duration: dur(250) }}
                  in:fly|global={{ y: 8, duration: dur(200), delay: stagger(i, 25) }}
                  out:slide={{ duration: dur(200) }}
                >
                  <SwipeRow
                    left={{ label: 'Delete', icon: 'trash', tone: 'bad', run: () => removeWord(c) }}
                    right={st === 'known'
                      ? { label: 'Not learned', icon: 'refresh', tone: 'warn', run: () => toggleKnown(c) }
                      : { label: 'Known', icon: 'check', tone: 'good', run: () => toggleKnown(c) }}
                  >
                    <div class="word">
                      <a class="main" href="#/card/{c.id}">
                        <span class="dot st-{st}" title={STATUS_LABELS[st]}></span>
                        <span class="texts">
                          <span class="line1">
                            <span class="de"><Term card={c} /></span>
                            {#if data.value?.hard.has(c.id!)}<span class="hard" title="Hard word"><Icon name="flame" size={14} filled /></span>{/if}
                            {#if c.translation}<span class="tr">{c.translation}</span>{/if}
                          </span>
                          {#if secondLine(c) || c.needsFill}
                            <span class="sub">
                              {secondLine(c)}
                              {#if c.needsFill}<span class="pending">details pending</span>{/if}
                            </span>
                          {/if}
                        </span>
                      </a>
                      <SpeakButton text={speakableTerm(c)} />
                      <button
                        class="icon-btn star"
                        class:on={c.starred}
                        aria-label={c.starred ? 'Unstar' : 'Star'}
                        aria-pressed={!!c.starred}
                        onclick={() => toggleStar(c)}
                      >
                        <Icon name="star" filled={!!c.starred} />
                      </button>
                    </div>
                  </SwipeRow>
                </div>
              {/each}
            </div>
            <p class="hint small muted center">Swipe a word left to delete, right to mark it known.</p>
          {/if}
        </section>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .grow {
    flex: 1;
    min-width: 0;
  }
  .progress {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
  }
  .pct {
    font-family: var(--font-display);
    font-weight: 900;
    color: var(--accent);
  }
  .banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    color: var(--text);
  }
  .banner {
    background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  }
  .banner > :global(svg) {
    color: var(--accent);
    flex-shrink: 0;
  }

  /* ---------- Filter chips ---------- */
  .chips {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    margin: 0 -16px 12px;
    padding: 2px 16px;
    scrollbar-width: none;
  }
  .chips::-webkit-scrollbar {
    display: none;
  }
  .fchip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 38px;
    padding: 6px 14px;
    border: 0;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: var(--shadow);
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 800;
    transition:
      background-color var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease);
    white-space: nowrap;
    cursor: pointer;
    flex-shrink: 0;
  }
  .fchip.active {
    background: var(--accent-fill);
    color: var(--accent-text);
    box-shadow: var(--shadow-accent);
  }
  .fchip:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .n {
    font-weight: 500;
    opacity: 0.7;
  }

  .search {
    position: relative;
    margin-bottom: 12px;
  }
  .search > span {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
  }
  .search .input {
    padding-left: 38px;
  }

  /* ---------- Words ---------- */
  .words {
    background: var(--surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  .w {
    position: relative;
  }
  .w + .w::before {
    content: '';
    position: absolute;
    z-index: 2;
    top: 0;
    left: 33px;
    right: 0;
    border-top: 1px solid var(--border);
    opacity: 0.7;
    pointer-events: none;
  }
  .word {
    display: flex;
    align-items: center;
    min-height: 62px;
    padding: 8px 4px 8px 14px;
    background: var(--surface);
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    align-self: stretch;
    color: inherit;
    text-decoration: none;
  }
  .texts {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  /* German on the first line, the translation (often several meanings) wraps below it. */
  .line1 {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 6px;
    min-width: 0;
  }
  .de {
    font-family: var(--font-display);
    font-size: 17.5px;
    font-weight: 800;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tr {
    flex: 1 0 100%;
    min-width: 0;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: break-word;
    font-size: 15px;
    line-height: 1.3;
    color: var(--text-2);
  }
  .sub {
    font-size: 14px;
    color: var(--muted);
  }
  .pending {
    color: var(--warn);
    font-size: 12px;
    font-weight: 600;
    margin-left: 4px;
  }
  .hard {
    display: inline-flex;
    color: var(--warn);
    vertical-align: -2px;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .st-new {
    background: var(--surface-3);
  }
  .st-learning {
    background: var(--accent-bar);
  }
  .st-learned {
    background: var(--good);
  }
  .st-known {
    background: var(--good);
    opacity: 0.45;
  }
  .star,
  .word :global(.icon-btn) {
    color: var(--muted);
  }
  .star.on {
    color: var(--accent);
  }
  .hint {
    margin: 10px 8px 0;
  }
</style>
