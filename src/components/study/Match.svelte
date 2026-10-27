<script lang="ts">
  import { normalize } from '../../lib/german/answer';
  import { displayTerm } from '../../lib/german/articles';
  import { backOut } from 'svelte/easing';
  import { scale } from 'svelte/transition';
  import { dur } from '../../lib/motion';
  import { matchRounds } from '../../lib/study/quiz';
  import { shuffle } from '../../lib/study/session';
  import type { Card } from '../../lib/types';

  /**
   * Match: rounds of 6 German/translation pairs. Tap a tile, then its partner. A wrong pairing
   * flashes red and counts as a mistake for the first-tapped card (once per card).
   */
  let {
    cards,
    onmistake,
    onprogress,
    onfinish,
  }: {
    cards: Card[];
    onmistake: (card: Card) => void;
    onprogress: (matched: number) => void;
    onfinish: (missed: Card[]) => void;
  } = $props();

  interface Tile {
    key: string;
    card: Card;
    side: 'de' | 'x';
    text: string;
  }

  // Cards are fixed for the lifetime of this component (the parent keys it per session).
  const rounds = $derived(matchRounds(shuffle(cards)));
  let roundIdx = $state(0);
  const round = $derived(rounds[roundIdx] ?? []);

  const tiles = $derived.by(() => ({
    de: shuffle(round.map((c): Tile => ({ key: `de${c.id}`, card: c, side: 'de', text: displayTerm(c) }))),
    x: shuffle(round.map((c): Tile => ({ key: `x${c.id}`, card: c, side: 'x', text: c.translation }))),
  }));

  let matched = $state<Record<string, boolean>>({});
  let selected = $state<Tile | null>(null);
  let wrong = $state<string[]>([]);
  let matchedTotal = 0;
  const missed = new Map<Card, true>();
  let wrongTimer: ReturnType<typeof setTimeout> | undefined;

  function pairs(a: Tile, b: Tile): boolean {
    const de = a.side === 'de' ? a : b;
    const x = a.side === 'x' ? a : b;
    if (de.card === x.card) return true;
    // Different cards with identical text are interchangeable.
    return normalize(de.card.translation) === normalize(x.text) || normalize(displayTerm(x.card)) === normalize(de.text);
  }

  function tap(t: Tile) {
    if (matched[t.key]) return;
    if (!selected || selected.side === t.side) {
      selected = selected?.key === t.key ? null : t;
      return;
    }
    const a = selected;
    selected = null;
    if (pairs(a, t)) {
      matched = { ...matched, [a.key]: true, [t.key]: true };
      matchedTotal++;
      onprogress(matchedTotal);
      if (Object.keys(matched).length === round.length * 2) setTimeout(nextRound, 350);
    } else {
      clearTimeout(wrongTimer);
      wrong = [a.key, t.key];
      wrongTimer = setTimeout(() => (wrong = []), 600);
      if (!missed.has(a.card)) {
        missed.set(a.card, true);
        onmistake(a.card);
      }
    }
  }

  function nextRound() {
    if (roundIdx + 1 < rounds.length) {
      matched = {};
      wrong = [];
      roundIdx++;
    } else {
      onfinish([...missed.keys()]);
    }
  }
</script>

{#snippet tile(t: Tile, i: number)}
  <button
    in:scale|global={{ start: 0.85, duration: dur(260), delay: dur(i * 35), easing: backOut }}
    type="button"
    class="tile"
    class:de={t.side === 'de'}
    class:selected={selected?.key === t.key}
    class:matched={matched[t.key]}
    class:wrong={wrong.includes(t.key)}
    disabled={matched[t.key]}
    lang={t.side === 'de' ? 'de' : undefined}
    onclick={() => tap(t)}>{t.text}</button
  >
{/snippet}

<div class="stack">
  {#if rounds.length > 1}
    <div class="muted small center">Round {roundIdx + 1} of {rounds.length}</div>
  {/if}
  {#key roundIdx}
    <div class="board">
      <div class="col">
        {#each tiles.de as t, i (t.key)}{@render tile(t, i * 2)}{/each}
      </div>
      <div class="col">
        {#each tiles.x as t, i (t.key)}{@render tile(t, i * 2 + 1)}{/each}
      </div>
    </div>
  {/key}
</div>

<style>
  .board {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .tile {
    min-height: 64px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    border: 2px solid var(--border);
    background: var(--surface);
    font-size: 16px;
    line-height: 1.25;
    cursor: pointer;
    overflow-wrap: anywhere;
    transition:
      opacity 0.3s ease,
      transform 0.3s ease,
      background-color 0.15s,
      border-color 0.15s;
  }
  .tile:not(:disabled):active {
    transform: scale(0.97);
  }
  .tile.de {
    font-weight: 600;
  }
  .tile.selected {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  }
  .tile.matched {
    border-color: var(--good);
    background: color-mix(in srgb, var(--good) 16%, var(--surface));
    pointer-events: none;
    animation: matched 0.45s var(--ease, ease) forwards;
  }
  @keyframes matched {
    0% {
      transform: scale(1);
      opacity: 1;
    }
    35% {
      transform: scale(1.07);
      opacity: 1;
    }
    100% {
      transform: scale(0.9);
      opacity: 0;
    }
  }
  .tile.wrong {
    border-color: var(--bad);
    background: color-mix(in srgb, var(--bad) 14%, var(--surface));
    animation: shake 0.35s;
  }
  .tile:disabled {
    color: inherit;
  }
  @media (prefers-reduced-motion: reduce) {
    .tile {
      transition: none;
    }
    .tile.matched {
      animation: none;
      opacity: 0;
    }
    .tile.wrong {
      animation: none;
    }
  }
  @keyframes shake {
    25% {
      transform: translateX(-4px);
    }
    75% {
      transform: translateX(4px);
    }
  }
</style>
