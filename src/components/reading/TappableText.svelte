<script lang="ts">
  import Sheet from '../Sheet.svelte';
  import WordSheet from './WordSheet.svelte';
  import { live } from '../../lib/live.svelte';
  import { online } from '../../lib/online.svelte';
  import { settings } from '../../lib/settings.svelte';
  import { t } from '../../lib/i18n.svelte';
  import type { LexEntry } from '../../lib/dict/types';
  import { lookupWord } from '../../lib/lookup/lookup';
  import { comfortRank, isFunctionWord, UNKNOWN_RANK } from '../../lib/reading/level';
  import { groupText, reflexiveVerbs, verbGroups, type ReflexiveVerb, type VerbGroup } from '../../lib/reading/reflexive';
  import { splitGuess, splitVerbs, type SplitGuess, type SplitVerb } from '../../lib/reading/separable';
  import { sentenceAt, tokenize, type Token } from '../../lib/reading/text';
  import { cardsFor, cardsOfReading, cardsOfTerm, lemmaMap, loadVocab, type CardRef } from '../../lib/reading/vocab';
  import { translatorTarget, type WordTarget } from '../../lib/reading/wordTarget';
  import { tokenReadings } from '../../lib/reading/wordSense';

  /**
   * German text whose words can be tapped, as in the reader (routes/Reader.svelte, whose word
   * logic this follows): split verbs ("rufe … an") and reflexive verbs are one word, words being
   * learned are tinted and new ones dotted. A tap opens the word sheet, which adds the word to
   * `target`'s set (the translator's set by default). Each line of `text` stays a line.
   */
  let { text, target = translatorTarget() }: { text: string; target?: WordTarget } = $props();

  const vocab = live(loadVocab);
  const targetSet = live(() => target.findSet());
  const setId = $derived(targetSet.value ?? 0);

  const lines = $derived(text.split(/\r\n?|\n/));
  /** Tokens per line. Results found for a text are tagged with its tokens: an old text's never apply to a newer one. */
  const tokens = $derived(lines.map(tokenize));

  /** A result for the tokens `of` (async lookups finish after the text may have changed). */
  type For<T> = { of: Token[][]; value: T } | null;
  const now = <T,>(x: For<T>): T | null => (x && x.of === tokens ? x.value : null);

  // ---------- Words: lemmas, verbs written as several words, readings by position ----------

  /** By spelling, so an older text's map still serves until the new one is there. */
  let lemmas = $state.raw<Map<string, LexEntry | null> | null>(null);

  $effect(() => {
    const list = tokens;
    if (!list.some((l) => l.length)) return;
    let cancelled = false;
    void lemmaMap(list)
      .then((m) => !cancelled && (lemmas = m))
      .catch(() => !cancelled && (lemmas = lemmas ?? new Map()));
    return () => {
      cancelled = true;
    };
  });

  let splitsFor = $state.raw<For<Map<number, SplitVerb>[]>>(null);
  let reflexivesFor = $state.raw<For<Map<number, ReflexiveVerb>[]>>(null);

  $effect(() => {
    const list = tokens;
    if (!list.some((l) => l.length)) return;
    let cancelled = false;
    void splitVerbs(list)
      .then(async (m) => {
        if (cancelled) return;
        splitsFor = { of: list, value: m };
        const r = await reflexiveVerbs(list, m);
        if (!cancelled) reflexivesFor = { of: list, value: r };
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });

  let readingsFor = $state.raw<For<Map<number, LexEntry[]>[]>>(null);

  $effect(() => {
    const list = tokens;
    if (!list.some((l) => l.length)) return;
    let cancelled = false;
    void tokenReadings(list)
      .then((r) => !cancelled && (readingsFor = { of: list, value: r }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });

  const splits = $derived(now(splitsFor));
  const reflexives = $derived(now(reflexivesFor));
  const readings = $derived(now(readingsFor));

  /** Rare split verbs confirmed online after a tap, by line. */
  let foundFor = $state.raw<For<Record<number, VerbGroup[]>>>(null);

  /** Verbs written as several tokens, per line: a reflexive verb wins over a split one sharing a token. */
  const groups = $derived.by(() => {
    if (!splits) return null;
    const found = now(foundFor) ?? {};
    return splits.map((m, p) => {
      const out = verbGroups(m, reflexives?.[p]);
      for (const g of found[p] ?? []) for (const i of g.tokens) out.set(i, g);
      return out;
    });
  });

  const groupAt = (p: number, i: number): VerbGroup | undefined => groups?.[p]?.get(i);
  const readingAt = (p: number, i: number): LexEntry | undefined => readings?.[p]?.get(i)?.[0];

  const NO_LEMMAS = new Map<string, LexEntry | null>();
  const cardsOf = (w: string): CardRef[] => (vocab.value ? cardsFor(w, lemmas ?? NO_LEMMAS, vocab.value) : []);
  const cardsOfWord = (term: string): CardRef[] => cardsOfTerm(term, vocab.value);
  const cardsOfEntry = (e: LexEntry): CardRef[] => cardsOfWord(e.term);
  /** Cards for a word read as `e` (its reading at a position), else as its spelling. */
  const cardsAs = (word: string, e: LexEntry | undefined): CardRef[] =>
    e && vocab.value ? cardsOfReading(word, e, vocab.value) : cardsOf(word);

  // ---------- Colours (as in the reader) ----------

  const comfort = $derived(comfortRank(settings.focus));
  const isNewWord = (e: LexEntry | null | undefined, word: string) =>
    e ? !isFunctionWord(e) && e.rank > comfort : /^\p{Ll}/u.test(word) && word.length > 2;

  const colourOf = (refs: CardRef[], e: LexEntry | null | undefined, word: string) =>
    refs.length ? (refs[0].status === 'learning' ? 'l' : '') : isNewWord(e, word) ? 'u' : '';

  const classes = $derived.by(() => {
    const map = new Map<string, string>();
    if (!vocab.value) return map;
    for (const list of tokens)
      for (const tk of list) {
        if (!tk.word || map.has(tk.text)) continue;
        const refs = cardsOf(tk.text);
        map.set(tk.text, refs.length || lemmas ? colourOf(refs, lemmas?.get(tk.text), tk.text) : '');
      }
    return map;
  });

  const groupClasses = $derived.by(() => {
    if (!groups || !vocab.value) return null;
    return groups.map((m) => {
      const out = new Map<number, string>();
      for (const g of new Set(m.values())) {
        const cls = colourOf(cardsOfEntry(g.entry), g.entry, g.entry.term);
        for (const i of g.tokens) out.set(i, cls);
      }
      return out;
    });
  });

  const readingClasses = $derived.by(() => {
    if (!readings || !lemmas || !vocab.value) return null;
    return readings.map((m, p) => {
      const out = new Map<number, string>();
      for (const [i, list] of m) {
        const word = tokens[p][i].text;
        const usual = lemmas!.get(word);
        if (list[0].term === usual?.term && list[0].pos === usual.pos) continue;
        out.set(i, colourOf(cardsAs(word, list[0]), list[0], word));
      }
      return out;
    });
  });

  const classOf = (p: number, i: number, word: string) => {
    const cls = groupClasses?.[p]?.get(i) ?? readingClasses?.[p]?.get(i) ?? classes.get(word) ?? '';
    return groupAt(p, i) ? `${cls} g` : cls;
  };

  // ---------- Tapping a word ----------

  let sheetOpen = $state(false);
  /**
   * The tapped word, with what the sheet needs taken at the tap: when the text changes while the
   * sheet is open, the sheet stays on the word tapped. `of` is the text's tokens it was tapped in.
   */
  let sel = $state.raw<{
    of: Token[][];
    p: number;
    i: number;
    word: string;
    written?: string;
    group: VerbGroup | null;
    readings?: LexEntry[];
    context: string;
    key: number;
  } | null>(null);
  let selKey = 0;

  const isSel = (p: number, i: number) => sheetOpen && sel?.of === tokens && sel.p === p && (sel.i === i || !!sel.group?.tokens.includes(i));

  /** The sheet's word: its readings follow the text while it is the one tapped in. */
  const sheet = $derived.by(() => {
    if (!sel) return null;
    const list = sel.group ? undefined : sel.of === tokens ? readings?.[sel.p]?.get(sel.i) : sel.readings;
    return {
      entry: sel.group ? sel.group.entry : (list?.[0] ?? lemmas?.get(sel.word) ?? null),
      readings: list,
      cards: sel.group ? cardsOfEntry(sel.group.entry) : cardsAs(sel.word, list?.[0]),
    };
  });

  function contextAt(list: Token[][], p: number, i: number) {
    const offset = list[p].slice(0, i).reduce((n, x) => n + x.text.length, 0);
    return sentenceAt(lines[p], offset);
  }

  /** Answers of the online lookup for a guessed split verb, asked once per text. */
  let guesses = new Map<string, Promise<VerbGroup | null>>();
  let guessesOf: Token[][] | null = null;

  function confirmGuess(list: Token[][], p: number, guess: SplitGuess): Promise<VerbGroup | null> {
    if (guessesOf !== list) {
      guesses = new Map();
      guessesOf = list;
    }
    const key = `${p}:${guess.verb}:${guess.particle}`;
    let answer = guesses.get(key);
    if (!answer) {
      const ids = [guess.verb, guess.particle, ...(guess.pronoun === undefined ? [] : [guess.pronoun])].sort((a, b) => a - b);
      answer = lookupWord(guess.term, settings.lang)
        .then((r) => {
          // A translation-only answer (Google) proves nothing: it translates any made-up verb.
          if (list !== tokens || r?.pos !== 'verb' || r.source === 'google' || ids.some((i) => groupAt(p, i))) return null;
          const g: VerbGroup = {
            verb: guess.verb,
            tokens: ids,
            entry: { term: r.term, pos: 'verb', genders: [], plural: '', praeteritum: r.praeteritum, partizip2: r.partizip2, auxiliary: r.auxiliary, tr: { ru: '', en: '' }, rank: UNKNOWN_RANK },
          };
          const found = now(foundFor) ?? {};
          foundFor = { of: list, value: { ...found, [p]: [...(found[p] ?? []), g] } };
          return g;
        })
        .catch(() => null);
      guesses.set(key, answer);
    }
    return answer;
  }

  /** A word without a verb group may be a split verb too rare for the offline dictionary: try it, quietly. */
  async function tryGuess(list: Token[][], p: number, i: number, key: number) {
    if (!reflexives) return;
    const guess = splitGuess(list[p], i);
    if (!guess || !(online.value || (guessesOf === list && guesses.has(`${p}:${guess.verb}:${guess.particle}`)))) return;
    const group = await confirmGuess(list, p, guess);
    if (group && key === selKey && sheetOpen && list === tokens) {
      sel = { of: list, p, i, word: group.entry.term, written: groupText(list[p], group), group, context: contextAt(list, p, group.verb), key: ++selKey };
    }
  }

  function onTap(e: MouseEvent) {
    const span = (e.target as Element | null)?.closest?.<HTMLElement>('[data-t]');
    const line = span?.closest<HTMLElement>('[data-p]');
    if (!span || !line) return;
    const list = tokens;
    const p = Number(line.dataset.p);
    const i = Number(span.dataset.t);
    const tk = list[p]?.[i];
    if (!tk?.word) return;
    const group = groupAt(p, i) ?? null;
    const key = ++selKey;
    sel = {
      of: list,
      p,
      i,
      word: group ? group.entry.term : tk.text,
      written: group ? groupText(list[p], group) : undefined,
      group,
      readings: group ? undefined : readings?.[p]?.get(i),
      // The context is the verb's sentence, whichever token of the group was tapped.
      context: contextAt(list, p, group ? group.verb : i),
      key,
    };
    sheetOpen = true;
    if (!group) void tryGuess(list, p, i, key);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="tappable" lang="de" onclick={onTap}>
  {#each tokens as list, pi (pi)}
    <p class="line" data-p={pi}>{#each list as tk, ti}{#if tk.word}<span class="w {classOf(pi, ti, tk.text)}" class:sel={isSel(pi, ti)} data-t={ti}>{tk.text}</span>{:else}{tk.text}{/if}{/each}{#if !list.length}<br />{/if}</p>
  {/each}
</div>

<Sheet bind:open={sheetOpen} title={t('reading.reader.wordSheet')}>
  {#if sel && sheet}
    {#key sel.key}
      <WordSheet
        word={sel.word}
        written={sel.written}
        entry={sheet.entry}
        readings={sheet.readings}
        context={sel.context}
        {target}
        {setId}
        cards={sheet.cards}
        cardsOfTerm={cardsOfWord}
        onclose={() => (sheetOpen = false)}
      />
    {/key}
  {/if}
</Sheet>

<style>
  .tappable {
    white-space: pre-wrap;
    overflow-wrap: break-word;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }
  .line {
    margin: 0;
  }
  .w {
    border-radius: 5px;
    cursor: pointer;
    transition: background-color var(--dur-fast) var(--ease);
  }
  .w.u {
    text-decoration: underline dotted;
    text-decoration-color: color-mix(in srgb, var(--muted) 70%, transparent);
    text-decoration-thickness: 1.5px;
    text-underline-offset: 4px;
  }
  .w.l {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .w.sel {
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 28%, transparent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 28%, transparent);
  }
  /* One verb in several words: a thin solid line under each (as in the reader). */
  .w.g:not(.sel) {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }
  .w.g {
    background-image: linear-gradient(color-mix(in srgb, var(--accent) 60%, transparent) 0 0);
    background-repeat: no-repeat;
    background-position: 0 100%;
    background-size: 100% 1.5px;
  }
  .w.g.u {
    text-underline-offset: 2px;
  }
</style>
