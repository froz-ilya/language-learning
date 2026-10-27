<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fade, fly, slide } from 'svelte/transition';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import ProgressRing from '../components/ProgressRing.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import ProgressRow from '../components/library/ProgressRow.svelte';
  import FillProgress from '../components/library/FillProgress.svelte';
  import { afterSheet, isLevel, levelIndex, levelName, plural, setKnownWithUndo, stagger } from '../components/library/actions';
  import { go, route } from '../lib/router.svelte';
  import { live } from '../lib/live.svelte';
  import { dur } from '../lib/motion';
  import { online } from '../lib/online.svelte';
  import { saveSettings, settings } from '../lib/settings.svelte';
  import { cardsInFolder, levelFolder, setsInFolder } from '../lib/db/repo';
  import { progressOf, reviewsFor, STATUS_LABELS, type WordStatus } from '../lib/progress';
  import { installLevel, uninstallLevel } from '../lib/levels/install';
  import { LEVEL_TITLES, type LevelIndex } from '../lib/levels/types';
  import { chooseAction, confirmAction, showToast } from '../lib/ui/dialogs.svelte';
  import type { Card } from '../lib/types';

  const raw = (route.parts[1] ?? '').toUpperCase();
  const code = isLevel(raw) ? raw : null;

  const DESCRIPTIONS: Record<string, string> = {
    A1: 'Your very first words: people, numbers, food, home and the everyday verbs you hear all the time.',
    A2: 'Everyday situations: shopping, travel, work, health and describing the world around you.',
    B1: 'Talk about experiences, plans and opinions — the words that make conversations flow.',
    B2: 'Richer vocabulary for news, work and abstract topics.',
    C1: 'Nuanced words for complex texts and precise expression.',
    C2: 'Rare and refined vocabulary for near-native reading.',
  };

  const data = live(async () => {
    if (!code) return null;
    const folder = await levelFolder(code);
    if (!folder) return { installed: false as const };
    const [sets, cards] = await Promise.all([setsInFolder(folder.id!, 'name'), cardsInFolder(folder.id!)]);
    sets.sort((a, b) => a.id! - b.id!); // install order = topic order
    const reviews = await reviewsFor(cards);
    const bySetCards = new Map<number, Card[]>();
    for (const c of cards) bySetCards.set(c.setId, [...(bySetCards.get(c.setId) ?? []), c]);
    const bySet = new Map(sets.map((s) => [s.id!, progressOf(bySetCards.get(s.id!) ?? [], reviews)]));
    return {
      installed: true as const,
      folder,
      sets,
      progress: progressOf(cards, reviews),
      bySet,
      ids: cards.map((c) => c.id!),
    };
  });

  let index = $state<LevelIndex | null>(null);
  levelIndex().then((i) => (index = i));
  const info = $derived(index?.levels.find((l) => l.code === code));

  const STATUS_ORDER: WordStatus[] = ['new', 'learning', 'learned', 'known'];

  // ---------- Install ----------

  let installing = $state<{ done: number; total: number } | null>(null);
  let installError = $state('');

  async function install(): Promise<boolean> {
    if (!code || installing) return false;
    installError = '';
    installing = { done: 0, total: info?.words ?? 0 };
    try {
      await installLevel(code, settings.lang, (done, total) => (installing = { done, total }));
      return true;
    } catch (e) {
      console.warn('install failed', e);
      installError = online.value
        ? `Couldn’t get the words ready. ${(e as Error).message || ''}`.trim()
        : 'You’re offline. Connect to the internet to download this level.';
      return false;
    } finally {
      installing = null;
    }
  }

  function makeFocus() {
    if (!code) return;
    const focus = `level/${code}`;
    if (settings.focus !== focus) {
      settings.focus = focus;
      void saveSettings();
    }
  }

  async function start() {
    if (await install()) {
      makeFocus();
      showToast(`${code} is ready. Viel Erfolg!`);
    }
  }

  async function placement() {
    if (data.value?.installed || (await install())) go(`/placement/${code}`);
  }

  function learn() {
    makeFocus();
    go(`/learn/level/${code}`);
  }

  // ---------- Menu ----------

  function menu() {
    const d = data.value;
    if (!code || !d?.installed) return;
    const name = levelName(code);
    return chooseAction(name, [
      {
        label: 'Mark whole level as known',
        icon: 'check',
        run: () =>
          void afterSheet(async () => {
            const ok = await confirmAction({
              title: `Mark all of ${code} as known?`,
              message: `All ${d.ids.length} words count as learned and are skipped in sessions.`,
              confirmLabel: 'Mark as known',
            });
            if (ok) await setKnownWithUndo(d.ids, true, `${code} marked as known`);
          }),
      },
      {
        label: 'Reset progress',
        icon: 'refresh',
        run: () =>
          void afterSheet(async () => {
            const ok = await confirmAction({
              title: `Reset progress in ${code}?`,
              message: 'Every word goes back to “New”.',
              confirmLabel: 'Reset',
              destructive: true,
            });
            if (ok) await setKnownWithUndo(d.ids, false, `${code} progress reset`);
          }),
      },
      {
        label: 'Remove level',
        icon: 'trash',
        destructive: true,
        run: () =>
          void afterSheet(async () => {
            const ok = await confirmAction({
              title: `Remove ${code}?`,
              message: 'Its words and your progress in this level will be deleted. You can add the level again later.',
              confirmLabel: 'Remove',
              destructive: true,
            });
            if (!ok) return;
            try {
              await uninstallLevel(code);
              if (settings.focus === `level/${code}`) {
                settings.focus = '';
                void saveSettings();
              }
              showToast(`${code} removed`);
            } catch (e) {
              showToast(`Couldn’t remove ${code}: ${(e as Error).message}`);
            }
          }),
      },
    ]);
  }
</script>

<div class="page">
  {#if !code}
    <Header title="Level" backTo="/levels" />
    <div class="empty">This level doesn’t exist.</div>
  {:else}
    <Header title={levelName(code)} backTo="/levels">
      {#snippet actions()}
        {#if data.value?.installed}
          <button class="icon-btn" aria-label="Level actions" onclick={menu}><Icon name="more" /></button>
        {/if}
      {/snippet}
    </Header>

    {#if !data.value}
      <div class="card"><Skeleton lines={5} /></div>
    {:else if !data.value.installed}
      <!-- ---------- Not started ---------- -->
      <div class="stack" in:fade|global={{ duration: dur(200) }}>
        <section class="intro card">
          <div class="badge">{code}</div>
          <h2>{LEVEL_TITLES[code]}</h2>
          <p class="muted">{DESCRIPTIONS[code]}</p>
          <div class="facts">
            {#if info}
              <span class="chip"><Icon name="cards" size={16} /> {info.words.toLocaleString('en')} words</span>
              <span class="chip">{plural(info.topics.length, 'topic')}</span>
            {/if}
          </div>
          {#if info?.topics.length}
            <div class="topics">
              {#each info.topics.slice(0, 8) as t}
                <span class="topic">{t.name}</span>
              {/each}
              {#if info.topics.length > 8}<span class="topic more">+{info.topics.length - 8} more</span>{/if}
            </div>
          {/if}
        </section>

        {#if installing}
          <div transition:slide={{ duration: dur(200) }}>
            <FillProgress done={installing.done} total={installing.total} label="Getting your words ready…" />
          </div>
        {:else}
          {#if installError}
            <div class="error small" transition:slide={{ duration: dur(200) }}>{installError}</div>
          {/if}
          <button class="btn btn-primary btn-lg btn-block" onclick={start}>
            <Icon name="play" filled size={18} /> {installError ? 'Try again' : 'Start this level'}
          </button>
          <button class="btn btn-ghost btn-block" onclick={placement}>I already know some — take a placement check</button>
        {/if}
      </div>
    {:else}
      <!-- ---------- Installed ---------- -->
      {@const d = data.value}
      <section class="summary card" in:fade|global={{ duration: dur(200) }}>
        <ProgressRing ratio={d.progress.ratio} size={112} stroke={10}>
          <span class="ring-text">
            <span class="pct">{Math.round(d.progress.ratio * 100)}%</span>
            <span class="ring-sub">learned</span>
          </span>
        </ProgressRing>
        <ul class="counts">
          {#each STATUS_ORDER as st}
            <li>
              <span class="dot st-{st}"></span>
              <span class="c-label">{STATUS_LABELS[st]}</span>
              <span class="c-num">{d.progress[st]}</span>
            </li>
          {/each}
        </ul>
      </section>

      <div class="stack actions">
        <button class="btn btn-primary btn-lg btn-block" disabled={!d.ids.length} onclick={learn}>
          <Icon name="play" filled size={18} /> Learn
        </button>
        <div class="row">
          <button class="btn grow" onclick={() => go(`/modes/level/${code}`)}><Icon name="cards" size={20} /> More ways to study</button>
          <button class="btn grow" onclick={() => go(`/placement/${code}`)}><Icon name="sparkle" size={20} /> Placement check</button>
        </div>
      </div>

      <section class="section">
        <h2 class="section-title">Topics <span>{d.sets.length}</span></h2>
        {#each d.sets as s, i (s.id)}
          <div
            class="item"
            animate:flip={{ duration: dur(250) }}
            in:fly|global={{ y: 10, duration: dur(220), delay: stagger(i) }}
            out:slide={{ duration: dur(200) }}
          >
            <ProgressRow
              href="#/set/{s.id}"
              title={s.topic || s.name}
              progress={d.bySet.get(s.id!)}
              right={{ label: 'Learn', icon: 'play', tone: 'accent', run: () => go(`/learn/set/${s.id}`) }}
            />
          </div>
        {/each}
      </section>
    {/if}
  {/if}
</div>

<style>
  .intro {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 8px;
    padding: 24px 18px;
  }
  .intro {
    position: relative;
    overflow: hidden;
    isolation: isolate;
    background: var(--grad-feature);
    border-radius: var(--radius-lg);
  }
  .intro::before {
    content: '';
    position: absolute;
    z-index: -1;
    top: -110px;
    left: 50%;
    width: 280px;
    height: 280px;
    transform: translateX(-50%);
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--accent-fill) 22%, transparent), color-mix(in srgb, var(--accent-fill) 0%, transparent) 68%);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 76px;
    height: 76px;
    margin-bottom: 4px;
    border-radius: 24px;
    background: var(--accent-fill);
    color: var(--accent-text);
    box-shadow: var(--shadow-accent);
    font-family: var(--font-display);
    font-size: 28px;
    font-weight: 900;
    transform: rotate(-4deg);
  }
  .intro h2 {
    font-size: 24px;
  }
  .intro p {
    margin: 0;
  }
  .facts {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
  }
  .topics {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
    margin-top: 6px;
  }
  .topic {
    padding: 4px 11px;
    border-radius: 999px;
    background: var(--hairline);
    box-shadow: inset 0 0 0 1px var(--hairline);
    font-size: 13px;
    color: var(--muted);
  }
  .error {
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--bad) 12%, var(--surface));
    color: var(--bad);
    text-align: center;
  }

  .summary {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 18px 20px;
  }
  .ring-text {
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 1.1;
  }
  .pct {
    font-size: 28px;
    font-weight: 900;
  }
  .ring-sub {
    font-size: 12px;
    color: var(--muted);
  }
  .counts {
    flex: 1;
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .counts li {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dot {
    width: 10px;
    height: 10px;
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
  .c-label {
    flex: 1;
    color: var(--muted);
  }
  .c-num {
    font-family: var(--font-display);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .actions {
    margin-top: 14px;
  }
  .grow {
    flex: 1;
    min-width: 0;
    font-size: 15px;
    padding: 10px 8px;
  }
  .item {
    padding-bottom: 10px;
  }
</style>
