<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fly, slide } from 'svelte/transition';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import ProgressBar from '../components/ProgressBar.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import ProgressRow from '../components/library/ProgressRow.svelte';
  import EmptyState from '../components/library/EmptyState.svelte';
  import { afterSheet, createSet, learnedLine, plural, removeSet, stagger, sumProgress } from '../components/library/actions';
  import { go, replace, route } from '../lib/router.svelte';
  import { live } from '../lib/live.svelte';
  import { dur } from '../lib/motion';
  import { db } from '../lib/db/schema';
  import { deleteFolder, renameFolder, setsInFolder, updateSet } from '../lib/db/repo';
  import { progressBySet } from '../lib/progress';
  import { chooseAction, promptText, showToast, undoToast, type ActionItem } from '../lib/ui/dialogs.svelte';

  const id = Number(route.parts[1]);

  const data = live(async () => {
    const [folder, sets, unfiled] = await Promise.all([db.folders.get(id), setsInFolder(id), setsInFolder(0)]);
    const progress = await progressBySet(sets.map((s) => s.id!));
    return { folder, sets, unfiled: unfiled.filter((s) => !s.level), progress };
  });

  const folder = $derived(data.value?.folder);
  const sets = $derived(data.value?.sets ?? []);
  const total = $derived(data.value ? sumProgress([...data.value.progress.values()]) : undefined);

  // A level's folder lives on the Levels tab.
  $effect(() => {
    if (folder?.level) replace(`/level/${folder.level}`);
  });

  async function rename() {
    const name = await promptText({ title: 'Rename folder', value: folder?.name ?? '', confirmLabel: 'Save' });
    if (name) await renameFolder(id, name);
  }

  async function addExisting() {
    const list = data.value?.unfiled ?? [];
    await chooseAction(
      'Move a set into this folder',
      list.map((s) => ({
        label: s.name,
        icon: 'cards',
        run: async () => {
          await updateSet(s.id!, { folderId: id });
          showToast(`Moved “${s.name}” here`);
        },
      })),
    );
  }

  async function remove() {
    const name = folder?.name ?? 'Folder';
    const snapshot = await deleteFolder(id);
    replace('/library');
    undoToast(`Deleted “${name}” — its sets were kept`, snapshot);
  }

  function menu() {
    if (!folder) return;
    const items: ActionItem[] = [
      { label: 'New set here', icon: 'plus', run: () => void afterSheet(() => createSet(id)) },
    ];
    if (data.value?.unfiled.length)
      items.push({ label: 'Add an existing set', icon: 'cards', run: () => void afterSheet(addExisting) });
    items.push(
      { label: 'Import words', icon: 'import', run: () => go('/import', { folder: id }) },
      { label: 'Rename folder', icon: 'edit', run: () => void afterSheet(rename) },
      { label: 'Delete folder', icon: 'trash', destructive: true, run: remove },
    );
    return chooseAction(folder.name, items);
  }
</script>

<div class="page">
  {#if data.value && !folder}
    <Header title="Folder" backTo="/library" />
    <EmptyState icon="folder" title="This folder is gone" text="It may have been deleted.">
      <button class="btn btn-primary btn-block" onclick={() => go('/library')}>Back to Library</button>
    </EmptyState>
  {:else}
    <Header title={folder?.name ?? ''} subtitle={plural(sets.length, 'set')} backTo="/library">
      {#snippet actions()}
        {#if folder}
          <button class="icon-btn" aria-label="Folder actions" onclick={menu}><Icon name="more" /></button>
        {/if}
      {/snippet}
    </Header>

    {#if !data.value}
      <div class="card"><Skeleton lines={5} /></div>
    {:else if !sets.length}
      <EmptyState icon="folder" title="Nothing in here yet" text="Create a set in this folder, or move one you already have.">
        <button class="btn btn-primary btn-lg btn-block" onclick={() => createSet(id)}><Icon name="plus" /> New set</button>
        {#if data.value.unfiled.length}
          <button class="btn btn-block" onclick={addExisting}><Icon name="cards" /> Add an existing set</button>
        {/if}
      </EmptyState>
    {:else}
      <div class="stack">
        {#if total?.total}
          <div class="progress card">
            <div class="row small">
              <span class="muted">{learnedLine(total)}</span>
              <span class="spacer"></span>
              <span class="pct">{Math.round(total.ratio * 100)}%</span>
            </div>
            <ProgressBar progress={total} />
          </div>
        {/if}
        <button class="btn btn-primary btn-block btn-lg" disabled={!total?.total} onclick={() => go(`/learn/folder/${id}`)}>
          <Icon name="play" filled size={18} /> Learn all
        </button>
        <button class="btn btn-block" disabled={!total?.total} onclick={() => go(`/modes/folder/${id}`)}>
          <Icon name="cards" size={20} /> More ways to study
        </button>
      </div>

      <section class="section">
        <h2 class="section-title">
          Sets
          <button class="icon-btn" aria-label="New set" onclick={() => createSet(id)}><Icon name="plus" size={20} /></button>
        </h2>
        {#each sets as s, i (s.id)}
          <div
            class="item"
            animate:flip={{ duration: dur(250) }}
            in:fly|global={{ y: 10, duration: dur(220), delay: stagger(i) }}
            out:slide={{ duration: dur(200) }}
          >
            <ProgressRow
              href="#/set/{s.id}"
              title={s.name}
              progress={data.value.progress.get(s.id!)}
              left={{ label: 'Delete', icon: 'trash', tone: 'bad', run: () => removeSet(s) }}
              right={{ label: 'Learn', icon: 'play', tone: 'accent', run: () => go(`/learn/set/${s.id}`) }}
            />
          </div>
        {/each}
      </section>
    {/if}
  {/if}
</div>

<style>
  .progress {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
  }
  .pct {
    font-weight: 700;
  }
  .item {
    padding-bottom: 10px;
  }
  .section-title .icon-btn {
    width: 32px;
    height: 32px;
  }
</style>
