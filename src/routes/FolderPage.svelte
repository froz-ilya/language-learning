<script lang="ts">
  import { flip } from 'svelte/animate';
  import { slide } from 'svelte/transition';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import ProgressBar from '../components/ProgressBar.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import ProgressRow from '../components/library/ProgressRow.svelte';
  import EmptyState from '../components/library/EmptyState.svelte';
  import { afterSheet, createSet, learnedLine, removeSet, stagger, sumProgress } from '../components/library/actions';
  import { go, replace, route } from '../lib/router.svelte';
  import { live } from '../lib/live.svelte';
  import { systemName, t, tn } from '../lib/i18n.svelte';
  import { dur, enter } from '../lib/motion';
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
    const shown = systemName(folder?.name ?? '');
    const name = await promptText({ title: t('folder.rename'), value: shown, confirmLabel: t('common.save') });
    if (name && name !== shown) await renameFolder(id, name);
  }

  async function addExisting() {
    const list = data.value?.unfiled ?? [];
    await chooseAction(
      t('folder.moveHere'),
      list.map((s) => ({
        label: systemName(s.name),
        icon: 'cards',
        run: async () => {
          await updateSet(s.id!, { folderId: id });
          showToast(t('folder.movedHere', { name: systemName(s.name) }));
        },
      })),
    );
  }

  async function remove() {
    const name = folder ? systemName(folder.name) : t('common.folder');
    const snapshot = await deleteFolder(id);
    replace('/library');
    undoToast(t('folder.deleted', { name }), snapshot);
  }

  function menu() {
    if (!folder) return;
    const items: ActionItem[] = [
      { label: t('folder.newSetHere'), icon: 'plus', run: () => void afterSheet(() => createSet(id)) },
    ];
    if (data.value?.unfiled.length)
      items.push({ label: t('folder.addExisting'), icon: 'cards', run: () => void afterSheet(addExisting) });
    items.push(
      { label: t('library.importWords'), icon: 'import', run: () => go('/import', { folder: id }) },
      { label: t('folder.rename'), icon: 'edit', run: () => void afterSheet(rename) },
      { label: t('folder.delete'), icon: 'trash', destructive: true, run: remove },
    );
    return chooseAction(systemName(folder.name), items);
  }
</script>

<div class="page">
  {#if data.value && !folder}
    <Header title={t('common.folder')} backTo="/library" />
    <EmptyState icon="folder" title={t('folder.goneTitle')} text={t('folder.goneText')}>
      <button class="btn btn-primary btn-block" onclick={() => go('/library')}>{t('library.backToLibrary')}</button>
    </EmptyState>
  {:else}
    <Header title={folder ? systemName(folder.name) : ''} subtitle={tn('common.sets', sets.length)} backTo="/library">
      {#snippet actions()}
        {#if folder}
          <button class="icon-btn" aria-label={t('folder.actions')} onclick={menu}><Icon name="more" /></button>
        {/if}
      {/snippet}
    </Header>

    {#if !data.value}
      <div class="card"><Skeleton lines={5} /></div>
    {:else if !sets.length}
      <EmptyState icon="folder" title={t('folder.emptyTitle')} text={t('folder.emptyText')}>
        <button class="btn btn-primary btn-lg btn-block" onclick={() => createSet(id)}><Icon name="plus" /> {t('library.newSet')}</button>
        {#if data.value.unfiled.length}
          <button class="btn btn-block" onclick={addExisting}><Icon name="cards" /> {t('folder.addExisting')}</button>
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
          <Icon name="play" filled size={18} /> {t('folder.learnAll')}
        </button>
        <button class="btn btn-block" disabled={!total?.total} onclick={() => go(`/modes/folder/${id}`)}>
          <Icon name="cards" size={20} /> {t('library.moreWays')}
        </button>
      </div>

      <section class="section">
        <h2 class="section-title">
          {t('library.sets')}
          <button class="icon-btn" aria-label={t('library.newSet')} onclick={() => createSet(id)}><Icon name="plus" size={20} /></button>
        </h2>
        {#each sets as s, i (s.id)}
          <div
            class="item"
            animate:flip={{ duration: dur(250) }}
            in:enter|global={{ y: 10, duration: dur(220), delay: stagger(i) }}
            out:slide={{ duration: dur(200) }}
          >
            <ProgressRow
              href="#/set/{s.id}"
              title={systemName(s.name)}
              progress={data.value.progress.get(s.id!)}
              left={{ label: t('common.delete'), icon: 'trash', tone: 'bad', run: () => removeSet(s) }}
              right={{ label: t('library.learn'), icon: 'play', tone: 'accent', run: () => go(`/learn/set/${s.id}`) }}
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
    font-family: var(--font-display);
    font-weight: 900;
    color: var(--accent);
  }
  .item {
    padding-bottom: 10px;
  }
  .section-title .icon-btn {
    width: 32px;
    height: 32px;
  }
</style>
