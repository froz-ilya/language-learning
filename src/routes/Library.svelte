<script lang="ts">
  import { flip } from 'svelte/animate';
  import { slide } from 'svelte/transition';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import ProgressRow from '../components/library/ProgressRow.svelte';
  import EmptyState from '../components/library/EmptyState.svelte';
  import { afterSheet, createFolder, createSet, removeSet, stagger, sumProgress } from '../components/library/actions';
  import { go } from '../lib/router.svelte';
  import { primeKeyboard } from '../lib/ui/keyboard';
  import { live } from '../lib/live.svelte';
  import { systemName, t, tn } from '../lib/i18n.svelte';
  import { dur, enter } from '../lib/motion';
  import { db } from '../lib/db/schema';
  import { allFolders } from '../lib/db/repo';
  import { progressBySet } from '../lib/progress';
  import { chooseAction } from '../lib/ui/dialogs.svelte';

  const data = live(async () => {
    const [folders, sets] = await Promise.all([allFolders(), db.sets.orderBy('name').toArray()]);
    const own = sets.filter((s) => !s.level);
    const progress = await progressBySet(own.map((s) => s.id!));
    return { folders, sets: own, progress };
  });

  const folders = $derived(data.value?.folders ?? []);
  const unfiled = $derived((data.value?.sets ?? []).filter((s) => !s.folderId));
  const folderStats = $derived.by(() => {
    const m = new Map<number, { sets: number; progress: ReturnType<typeof sumProgress> }>();
    for (const f of folders) {
      const inside = (data.value?.sets ?? []).filter((s) => s.folderId === f.id);
      m.set(f.id!, {
        sets: inside.length,
        progress: sumProgress(inside.map((s) => data.value!.progress.get(s.id!)!).filter(Boolean)),
      });
    }
    return m;
  });
  const isEmpty = $derived(!!data.value && !folders.length && !unfiled.length);

  function addMenu() {
    return chooseAction(t('library.addTo'), [
      { label: t('library.newSet'), icon: 'cards', run: () => void afterSheet(() => createSet()) },
      { label: t('library.newFolder'), icon: 'folder', run: () => void afterSheet(() => createFolder()) },
      { label: t('library.importWords'), icon: 'import', run: () => go('/import') },
    ]);
  }

  /** Search, with the keyboard already up (see lib/ui/keyboard). */
  function openSearch() {
    primeKeyboard();
    go('/search');
  }
</script>

<div class="page">
  <Header title={t('library.title')}>
    {#snippet actions()}
      <button class="icon-btn" aria-label={t('library.searchWord')} onclick={openSearch}><Icon name="search" /></button>
      <button class="icon-btn" aria-label={t('library.import')} onclick={() => go('/import')}><Icon name="import" /></button>
      <button class="icon-btn plus" aria-label={t('common.add')} onclick={addMenu}><Icon name="plus" /></button>
    {/snippet}
  </Header>

  {#if !data.value}
    <div class="card"><Skeleton lines={5} /></div>
  {:else if isEmpty}
    <EmptyState icon="cards" title={t('library.emptyTitle')} text={t('library.emptyText')}>
      <button class="btn btn-primary btn-lg btn-block" onclick={() => createSet()}><Icon name="plus" /> {t('library.createSet')}</button>
      <button class="btn btn-block" onclick={() => go('/import')}><Icon name="import" /> {t('library.importWords')}</button>
    </EmptyState>
    <p class="hint small muted center">
      {t('library.readyMade')} <a href="#/levels">{t('library.browseLevels')}</a>
    </p>
  {:else}
    {#if folders.length}
      <section class="section">
        <h2 class="section-title">{t('library.folders')}</h2>
        <div class="rows">
          {#each folders as f, i (f.id)}
            {@const st = folderStats.get(f.id!)}
            <div
              class="item"
              animate:flip={{ duration: dur(250) }}
              in:enter|global={{ y: 10, duration: dur(220), delay: stagger(i) }}
              out:slide={{ duration: dur(200) }}
            >
              <ProgressRow
                href="#/folder/{f.id}"
                title={systemName(f.name)}
                icon="folder"
                tone="warn"
                sub={tn('common.sets', st?.sets ?? 0)}
                progress={st?.sets ? st.progress : undefined}
              />
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <section class="section">
      <h2 class="section-title">{t('library.sets')}</h2>
      {#if unfiled.length}
        <div class="rows">
          {#each unfiled as s, i (s.id)}
            {@const p = data.value.progress.get(s.id!)}
            <div
              class="item"
              animate:flip={{ duration: dur(250) }}
              in:enter|global={{ y: 10, duration: dur(220), delay: stagger(i + folders.length) }}
              out:slide={{ duration: dur(200) }}
            >
              <ProgressRow
                href="#/set/{s.id}"
                title={systemName(s.name)}
                progress={p}
                left={{ label: t('common.delete'), icon: 'trash', tone: 'bad', run: () => removeSet(s) }}
                right={{ label: t('library.learn'), icon: 'play', tone: 'accent', run: () => go(`/learn/set/${s.id}`) }}
              />
            </div>
          {/each}
        </div>
        <p class="hint small muted center">{t('library.swipeHint')}</p>
      {:else}
        <button class="btn btn-ghost btn-block" onclick={() => createSet()}><Icon name="plus" /> {t('library.newSet')}</button>
      {/if}
    </section>
  {/if}
</div>

<style>
  .item {
    padding-bottom: 10px;
  }
  .hint {
    margin: 4px 8px 0;
  }
  .hint a {
    color: var(--accent);
    font-weight: 600;
    text-decoration: none;
  }
  .plus {
    background: var(--accent-fill);
    color: var(--accent-text);
    width: 38px;
    height: 38px;
    margin-left: 6px;
    border-radius: 13px;
    box-shadow: var(--shadow-accent);
  }
  .plus:active {
    background: var(--accent-fill);
    opacity: 0.8;
  }
</style>
