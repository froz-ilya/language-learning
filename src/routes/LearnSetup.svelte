<script lang="ts">
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import { live } from '../lib/live.svelte';
  import { go, route } from '../lib/router.svelte';
  import { settings } from '../lib/settings.svelte';
  import { loadReviews } from '../lib/study/load';
  import { MODE_INFO } from '../lib/study/modes';
  import {
    filterByScope,
    isDirection,
    isStudyMode,
    modeAvailability,
    STUDY_MODES,
    type Scope,
    type StudyMode,
  } from '../lib/study/session';
  import { cardsForSource, sourceTitle, type SourceKind } from '../lib/study/sources';
  import type { Direction } from '../lib/types';

  // Route: #/modes/<kind>/<id> — "More ways to study" (constant: remounted on navigation).
  const kind = (route.parts[1] ?? 'smart') as SourceKind;
  const sourceId = route.parts[2] ?? 'all';
  const backTo =
    kind === 'set' ? `/set/${sourceId}` : kind === 'folder' ? `/folder/${sourceId}` : kind === 'level' ? `/level/${sourceId}` : '/';

  /** Last chosen mode / direction / scope, remembered on this device. */
  interface LastChoice {
    mode?: StudyMode;
    direction?: Direction;
    scope?: Scope;
  }
  const STORAGE_KEY = 'study:last-choice';

  function readLast(): LastChoice {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, string>;
      return {
        mode: isStudyMode(raw.mode) ? raw.mode : undefined,
        direction: isDirection(raw.direction) ? raw.direction : undefined,
        scope: raw.scope === 'all' || raw.scope === 'due' ? raw.scope : undefined,
      };
    } catch {
      return {};
    }
  }

  function writeLast(v: LastChoice) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    } catch {
      // Private mode / storage blocked: just don't remember.
    }
  }

  const last = readLast();

  const data = live(async () => {
    const [title, cards] = await Promise.all([sourceTitle(kind, sourceId), cardsForSource(kind, sourceId, settings.focus)]);
    const reviews = await loadReviews(cards);
    return { title, cards, reviews };
  });

  const cards = $derived(data.value?.cards ?? []);
  const dueCards = $derived(data.value ? filterByScope(cards, data.value.reviews, 'due') : []);

  let chosenScope = $state<Scope | null>(null);
  const scope = $derived<Scope>(chosenScope ?? (last.scope === 'all' || dueCards.length === 0 ? 'all' : 'due'));
  const scoped = $derived(scope === 'due' ? dueCards : cards);

  let direction = $state<Direction>(last.direction ?? settings.direction);
  const x = $derived(settings.lang.toUpperCase());

  const modes = $derived(
    STUDY_MODES.map((mode) => ({ mode, info: MODE_INFO[mode], ...modeAvailability(mode, scoped, cards.length) })),
  );

  function startMode(mode: StudyMode) {
    writeLast({ mode, direction, scope });
    go(`/study/${kind}/${sourceId}/${mode}`, { scope, dir: direction });
  }
</script>

<div class="page">
  <Header title="More ways to study" subtitle={data.value?.title ?? ''} {backTo} />

  {#if data.value && cards.length === 0}
    <div class="empty">No words here yet.</div>
  {:else if data.value}
    <button class="card smart" onclick={() => go(`/learn/${kind}/${sourceId}`)}>
      <div class="smart-icon"><Icon name="sparkle" /></div>
      <div class="smart-text">
        <div class="smart-title">Smart session</div>
        <div class="muted small">Due words first, then new ones — modes picked for you</div>
      </div>
      <span class="muted"><Icon name="chevron" size={18} /></span>
    </button>

    <div class="options card">
      <div class="opt">
        <div class="opt-label">Words</div>
        <div class="segmented">
          <button class:active={scope === 'due'} onclick={() => (chosenScope = 'due')}>Due & new · {dueCards.length}</button>
          <button class:active={scope === 'all'} onclick={() => (chosenScope = 'all')}>All · {cards.length}</button>
        </div>
      </div>
      <div class="opt">
        <div class="opt-label">Direction</div>
        <div class="segmented">
          <button class:active={direction === 'de-x'} onclick={() => (direction = 'de-x')}>DE → {x}</button>
          <button class:active={direction === 'x-de'} onclick={() => (direction = 'x-de')}>{x} → DE</button>
          <button class:active={direction === 'mixed'} onclick={() => (direction = 'mixed')}>Mixed</button>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Modes</div>
      <div class="list">
        {#each modes as m (m.mode)}
          <button class="list-item mode" disabled={!!m.reason} onclick={() => startMode(m.mode)}>
            <div class="mode-icon">
              {#if m.info.icon}<Icon name={m.info.icon} />{:else}<span class="badge">{m.info.badge}</span>{/if}
            </div>
            <div class="mode-text">
              <div class="title">
                {m.info.name}
                {#if last.mode === m.mode && !m.reason}<span class="last">Last used</span>{/if}
              </div>
              <div class="sub">
                {#if m.reason}{m.reason}{:else}{m.info.description}{#if m.count !== scoped.length && m.mode !== 'choice'}{` · ${m.count} words`}{/if}{/if}
              </div>
            </div>
            {#if !m.reason}<span class="muted"><Icon name="chevron" size={18} /></span>{/if}
          </button>
        {/each}
      </div>
    </div>
  {:else}
    <div class="empty">Loading…</div>
  {/if}
</div>

<style>
  .smart {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border: 0;
    text-align: left;
    cursor: pointer;
    transition: transform 0.12s ease;
  }
  .smart:active {
    transform: scale(0.98);
  }
  .smart-icon {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: var(--accent);
    color: var(--accent-text);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .smart-text {
    flex: 1;
    min-width: 0;
  }
  .smart-title {
    font-weight: 600;
  }
  .options {
    margin-top: 16px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .opt-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
    margin: 0 2px 6px;
  }
  .mode {
    min-height: 64px;
  }
  .mode:disabled {
    cursor: default;
    opacity: 0.45;
  }
  .mode:disabled:active {
    background: none;
  }
  .mode-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .badge {
    font-weight: 700;
    font-size: 15px;
    color: var(--der);
  }
  .mode-text {
    flex: 1;
    min-width: 0;
  }
  .last {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    vertical-align: 2px;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  @media (prefers-reduced-motion: reduce) {
    .smart {
      transition: none;
    }
  }
</style>
