<script lang="ts" module>
  /** What's in the field survives a trip to another page (e.g. a set opened from the word sheet). */
  const draft = { text: '' };
</script>

<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import SpeakButton from '../components/SpeakButton.svelte';
  import UmlautBar from '../components/UmlautBar.svelte';
  import TappableText from '../components/reading/TappableText.svelte';
  import LangRow from '../components/translate/LangRow.svelte';
  import TranslateHistory from '../components/translate/TranslateHistory.svelte';
  import { dur, enter } from '../lib/motion';
  import { online } from '../lib/online.svelte';
  import { settings } from '../lib/settings.svelte';
  import { fmtNumber, i18n, t } from '../lib/i18n.svelte';
  import type { MsgKey } from '../lib/i18n/messages';
  import { PROVIDER_LABELS } from '../lib/sources/chain';
  import { confirmAction, showToast } from '../lib/ui/dialogs.svelte';
  import { takeKeyboard } from '../lib/ui/keyboard';
  import { findExamples, wantsExamples, type ExamplePair } from '../lib/translate/examples';
  import type { Lang } from '../lib/types';
  import {
    MAX_TRANSLATE_CHARS,
    addHistory,
    clearHistory,
    loadHistory,
    removeHistory,
    translate,
    type HistoryItem,
    type TranslateLang,
    type TranslateOutcome,
  } from '../lib/translate/translate';

  /**
   * Translator (#/translate): German ↔ English/Russian as you type. The German side (the input or
   * the result) is tappable, so its words can be looked up and added to the learning sets.
   */

  // ---------- Languages ----------

  const PREFS_KEY = 'translator:langs';
  type Prefs = { other: Lang; fromGerman: boolean };

  function loadPrefs(): Prefs | null {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw) as Partial<Prefs> | null;
      if (v && (v.other === 'ru' || v.other === 'en') && typeof v.fromGerman === 'boolean') return { other: v.other, fromGerman: v.fromGerman };
    } catch {
      // Unreadable: defaults.
    }
    return null;
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ other, fromGerman } satisfies Prefs));
    } catch {
      // Storage blocked: the choice lasts for this visit only.
    }
  }

  const saved = loadPrefs();
  let chosen = !!saved;
  let other = $state<Lang>(saved?.other ?? settings.lang);
  let fromGerman = $state(saved?.fromGerman ?? true);

  // Settings load asynchronously: follow the translation language until the user picks one.
  $effect(() => {
    const l = settings.lang;
    if (!chosen) other = l;
  });

  const from = $derived<TranslateLang>(fromGerman ? 'de' : other);
  const to = $derived<TranslateLang>(fromGerman ? other : 'de');

  function setLangs(nextOther: Lang, nextFromGerman: boolean) {
    other = nextOther;
    fromGerman = nextFromGerman;
    chosen = true;
    savePrefs();
  }

  function swap() {
    saveToHistory();
    const result = outcome?.main && current ? outcome.main.text : '';
    reset();
    setLangs(other, !fromGerman);
    // Like a dictionary flipped over: the translation becomes the text to translate.
    if (result) text = result.slice(0, MAX_TRANSLATE_CHARS);
    runNow();
  }

  function pickOther(l: Lang) {
    if (l === other && chosen) return;
    saveToHistory();
    reset();
    setLangs(l, fromGerman);
    runNow();
  }

  // ---------- Input ----------

  let text = $state(draft.text);
  let inputEl = $state<HTMLTextAreaElement>();
  let focused = $state(false);
  const canReadClipboard = typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';

  const input = $derived(text.trim());
  const key = $derived(`${from}|${to}|${input}`);
  const nearLimit = $derived(text.length >= MAX_TRANSLATE_CHARS * 0.8);

  $effect(() => {
    draft.text = text;
  });

  // Auto-grow: the field is as tall as its text (CSS caps it, then it scrolls).
  $effect(() => {
    void text;
    const el = inputEl;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  });

  function onInput() {
    schedule();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    runNow();
    inputEl?.blur(); // keyboard down: the translation is below
  }

  function onBlur() {
    focused = false;
    runNow();
    saveToHistory();
  }

  function clearText() {
    saveToHistory();
    text = '';
    reset();
    inputEl?.focus();
  }

  async function pasteFromClipboard() {
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (!clip) return;
      if (clip.length > MAX_TRANSLATE_CHARS) showToast(t('translator.cut', { max: fmtNumber(MAX_TRANSLATE_CHARS) }));
      text = clip.slice(0, MAX_TRANSLATE_CHARS);
      runNow();
    } catch {
      showToast(t('translator.pasteFailed'));
    }
  }

  /** Keeps focus in the field when tapping its buttons (iOS keyboard stays up). */
  const keepFocus = (e: PointerEvent) => {
    if (focused) e.preventDefault();
  };

  // ---------- Translating ----------

  const DEBOUNCE_MS = 600;
  /** A translation the user has looked at this long without typing goes into the history. */
  const SETTLE_MS = 3000;

  /** What's shown: the latest outcome, possibly for an older text while the new one loads. */
  let outcome = $state.raw<TranslateOutcome | null>(null);
  /** The key (languages + text) `outcome` belongs to. */
  let shownFor = $state('');
  /** The key last asked for. */
  let askedFor = '';
  let loading = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let ctrl: AbortController | undefined;
  /** Tatoeba's sentence pairs and the key they belong to. */
  let examples = $state.raw<ExamplePair[]>([]);
  let examplesFor = $state('');

  function stop() {
    clearTimeout(timer);
    clearTimeout(settleTimer);
    ctrl?.abort();
    ctrl = undefined;
    askedFor = '';
    loading = false;
  }

  /** Forget the shown translation (other languages, or an empty field). */
  function reset() {
    stop();
    outcome = null;
    shownFor = '';
  }

  function schedule() {
    clearTimeout(timer);
    clearTimeout(settleTimer);
    if (!input) return reset();
    timer = setTimeout(run, DEBOUNCE_MS);
  }

  function runNow() {
    clearTimeout(timer);
    run();
  }

  function run() {
    const q = input;
    const k = key;
    if (!q) return;
    // Already being translated, or translated: nothing new to ask.
    if (k === askedFor && (loading || (shownFor === k && outcome && !outcome.unavailable))) return;
    ctrl?.abort();
    const c = new AbortController();
    ctrl = c;
    askedFor = k;
    loading = true;
    const show = (o: TranslateOutcome) => {
      outcome = o;
      shownFor = k;
    };
    // Real sentences with a word or short phrase, next to the translation (extra: a failure shows nothing).
    if (wantsExamples(q)) {
      findExamples(q, from, to, c.signal)
        .then((pairs) => {
          if (ctrl !== c) return;
          examples = pairs;
          examplesFor = k;
        })
        .catch(() => {});
    }
    translate(q, from, to, {
      signal: c.signal,
      onUpdate: (o) => {
        if (ctrl === c) show(o);
      },
    })
      .then((o) => {
        if (ctrl !== c) return;
        show(o);
        clearTimeout(settleTimer);
        settleTimer = setTimeout(saveToHistory, SETTLE_MS);
      })
      .catch((e: unknown) => {
        if (ctrl !== c || c.signal.aborted) return;
        console.warn('translate failed', e);
        const had = shownFor === k ? outcome : null;
        show({ main: had?.main ?? null, alternatives: had?.alternatives ?? [], dict: had?.dict ?? [], unavailable: !had?.main, done: true });
      })
      .finally(() => {
        if (ctrl === c) loading = false;
      });
  }

  function retry() {
    reset();
    runNow();
  }

  // Back online with a text that couldn't be translated: try again (once per reconnect).
  let wasOnline = online.value;
  $effect(() => {
    const now = online.value;
    if (now && !wasOnline && untrack(() => !!input && !main)) untrack(retry);
    wasOnline = now;
  });

  /** The outcome is for what's in the field now (an older one is shown dimmed while typing). */
  const current = $derived(shownFor === key);
  const main = $derived(outcome?.main ?? null);
  const pending = $derived(!!input && (!current || loading));
  const germanResult = $derived(to === 'de');

  // ---------- History ----------

  let history = $state(loadHistory());
  let savedKey = '';

  /** Keep the translation in view, once (not every debounce step). */
  function saveToHistory() {
    clearTimeout(settleTimer);
    if (!current || !main || !input || savedKey === key) return;
    savedKey = key;
    addHistory({ from, to, text: input, result: main.text, at: Date.now() });
    history = loadHistory();
  }

  function restore(item: HistoryItem) {
    const nextOther: Lang = item.from === 'de' ? (item.to as Lang) : (item.from as Lang);
    reset();
    setLangs(nextOther, item.from === 'de');
    text = item.text.slice(0, MAX_TRANSLATE_CHARS);
    runNow();
    window.scrollTo({ top: 0 });
  }

  function remove(item: HistoryItem) {
    removeHistory(item.at);
    history = loadHistory();
    showToast(t('translator.removed'), {
      actionLabel: t('common.undo'),
      onAction: () => {
        addHistory(item);
        history = loadHistory();
      },
    });
  }

  async function clearAll() {
    const ok = await confirmAction({ title: t('translator.clearRecent'), confirmLabel: t('words.clear'), destructive: true });
    if (!ok) return;
    clearHistory();
    history = [];
  }

  // ---------- Copy ----------

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      showToast(t('translator.copied'));
      saveToHistory();
    } catch {
      showToast(t('translator.copyFailed'));
    }
  }

  // ---------- Dictionary ----------

  type PosKey = Extract<MsgKey, 'common.noun' | 'common.verb' | 'common.adjective' | `translator.pos.${string}`>;
  const POS_KEYS: Record<string, PosKey> = {
    noun: 'common.noun',
    verb: 'common.verb',
    adjective: 'common.adjective',
    adverb: 'translator.pos.adverb',
    pronoun: 'translator.pos.pronoun',
    preposition: 'translator.pos.preposition',
    conjunction: 'translator.pos.conjunction',
    interjection: 'translator.pos.interjection',
    article: 'translator.pos.article',
    abbreviation: 'translator.pos.abbreviation',
    phrase: 'translator.pos.phrase',
    particle: 'translator.pos.particle',
    prefix: 'translator.pos.prefix',
    suffix: 'translator.pos.suffix',
    'auxiliary verb': 'translator.pos.auxiliaryVerb',
    numeral: 'translator.pos.numeral',
    number: 'translator.pos.numeral',
  };
  /** Google's English part-of-speech name in the interface language; '' when it's unknown. */
  const posLabel = (pos: string) => {
    const k = POS_KEYS[pos.trim().toLowerCase()];
    return k ? t(k) : '';
  };
  const dict = $derived((current && outcome?.dict) || []);
  const definitions = $derived((current && fromGerman && outcome?.definitions) || []);
  const shownExamples = $derived(examplesFor === key ? examples : []);
  /** The German sentence of a pair and the other one (the pair is in the field's language first). */
  const germanOf = (p: ExamplePair) => (fromGerman ? p.text : p.translation);
  const otherOf = (p: ExamplePair) => (fromGerman ? p.translation : p.text);
  const otherLang = $derived(fromGerman ? to : from);

  onMount(() => {
    takeKeyboard(inputEl);
    if (input) runNow();
    return () => {
      saveToHistory();
      stop();
    };
  });
</script>

<div class="page">
  <Header title={t('translator.title')} backTo="/" />

  <LangRow {from} {to} onswap={swap} onpick={pickOther} />

  <div class="field-box">
    <div class="input-wrap">
      <textarea
        class="input text"
        bind:this={inputEl}
        bind:value={text}
        oninput={onInput}
        onfocus={() => (focused = true)}
        onblur={onBlur}
        onkeydown={onKeydown}
        maxlength={MAX_TRANSLATE_CHARS}
        placeholder={fromGerman ? t('translator.placeholderDe') : t('translator.placeholderOther')}
        aria-label={t('translator.inputLabel')}
        lang={from}
        rows="3"
        autocapitalize="sentences"
        autocomplete="off"
        spellcheck="false"
        enterkeyhint="go"
      ></textarea>
      {#if text}
        <button type="button" class="clear" aria-label={t('words.clear')} onpointerdown={keepFocus} onclick={clearText}>
          <Icon name="x" size={16} />
        </button>
      {/if}
    </div>
    <div class="tools">
      {#if canReadClipboard}
        <button type="button" class="tool" onpointerdown={keepFocus} onclick={pasteFromClipboard}>
          <Icon name="paste" size={18} /> {t('translator.paste')}
        </button>
      {/if}
      <span class="spacer"></span>
      {#if nearLimit}
        <span class="count small" class:bad={text.length >= MAX_TRANSLATE_CHARS}>
          {t('translator.count', { n: fmtNumber(text.length), max: fmtNumber(MAX_TRANSLATE_CHARS) })}
        </span>
      {/if}
    </div>
    {#if fromGerman}<UmlautBar input={inputEl} />{/if}
  </div>

  <div class="results">
    {#if input}
      <section class="section first">
        <h2 class="section-title">{t('translator.result')}</h2>
        <div class="card result" class:stale={pending && !!main} aria-live="polite" aria-busy={pending}>
          {#if main}
            {#if germanResult}
              <div class="main-text" lang="de"><TappableText text={main.text} /></div>
            {:else}
              <p class="main-text" lang={to}>{main.text}</p>
            {/if}
            <div class="meta">
              <span class="via small muted">{t('translator.via', { source: PROVIDER_LABELS[main.via] ?? main.via })}</span>
              <span class="spacer"></span>
              {#if germanResult}<SpeakButton text={main.text} size={20} />{/if}
              <button type="button" class="icon-btn" aria-label={t('translator.copy')} onclick={() => main && void copy(main.text)}><Icon name="copy" size={20} /></button>
            </div>
          {:else if pending}
            <Skeleton lines={2} />
          {:else if !online.value}
            <div class="note" in:fade={{ duration: dur(150) }}>
              <Icon name="refresh" size={20} />
              <div class="small">
                <div class="note-title">{t('translator.offlineTitle')}</div>
                {t('translator.offline')}
              </div>
            </div>
          {:else if outcome?.unavailable}
            <div class="note" in:fade={{ duration: dur(150) }}>
              <Icon name="refresh" size={20} />
              <div class="small">
                <div class="note-title">{t('translator.unavailableTitle')}</div>
                {t('translator.unavailable')}
              </div>
            </div>
            <button type="button" class="btn btn-block retry" onclick={retry}>{t('common.retry')}</button>
          {:else}
            <p class="small muted">{t('translator.noResult')}</p>
          {/if}
        </div>
      </section>

      {#if fromGerman && main}
        <section class="section" in:enter={{ y: 8, duration: dur(200) }}>
          <h2 class="section-title">{t('translator.yourText')}</h2>
          <div class="card source">
            <div class="main-text" lang="de"><TappableText text={input} /></div>
            <div class="meta">
              <span class="spacer"></span>
              <SpeakButton text={input} size={20} />
            </div>
          </div>
        </section>
      {/if}

      {#if main}
        <p class="tap-hint small muted">{t('translator.tapHint')}</p>
      {/if}

      {#if main && dict.length}
        <section class="section" in:enter={{ y: 8, duration: dur(200) }}>
          <h2 class="section-title">{t('translator.dict')}</h2>
          <div class="card dict">
            {#each dict as d, i (i)}
              <p class="dict-row">
                {#if posLabel(d.pos)}<span class="pos">{posLabel(d.pos)}</span>{/if}
                <span lang={to}>{d.terms.join(', ')}</span>
              </p>
            {/each}
          </div>
        </section>
      {/if}

      {#if main && definitions.length}
        <section class="section" in:enter={{ y: 8, duration: dur(200) }}>
          <h2 class="section-title">{t('translator.definitions')}</h2>
          <div class="list">
            {#each definitions as d, i (i)}
              <div class="list-item def">
                <span class="grow">
                  <span class="title" lang="de">{#if posLabel(d.pos)}<span class="pos" lang={i18n.lang}>{posLabel(d.pos)}</span>{/if}{d.gloss}</span>
                  {#if d.example}<span class="sub" lang="de">{d.example}</span>{/if}
                </span>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if main && shownExamples.length}
        <section class="section" in:enter={{ y: 8, duration: dur(200) }}>
          <h2 class="section-title">{t('translator.examples')}</h2>
          <div class="list">
            {#each shownExamples as p (p.id)}
              <div class="list-item example">
                <span class="grow">
                  <span class="title" lang="de"><TappableText text={germanOf(p)} /></span>
                  <span class="sub" lang={otherLang}>{otherOf(p)}</span>
                </span>
              </div>
            {/each}
          </div>
          <p class="credit small muted">{t('translator.examplesCredit')}</p>
        </section>
      {/if}

      {#if main && current && (outcome?.alternatives.length || !outcome?.done)}
        <section class="section">
          <h2 class="section-title">{t('translator.others')}</h2>
          {#if outcome?.alternatives.length}
            <div class="list">
              {#each outcome.alternatives as alt (alt.via + alt.text)}
                <div class="list-item alt" in:enter={{ y: 6, duration: dur(200) }}>
                  <span class="grow">
                    <span class="title" lang={to}>{alt.text}</span>
                    <span class="sub">{t('translator.via', { source: PROVIDER_LABELS[alt.via] ?? alt.via })}</span>
                  </span>
                  <button type="button" class="icon-btn" aria-label={t('translator.copy')} onclick={() => void copy(alt.text)}><Icon name="copy" size={20} /></button>
                </div>
              {/each}
            </div>
          {/if}
          {#if !outcome?.done}
            <p class="asking small muted">{t('translator.asking')}</p>
          {/if}
        </section>
      {/if}
    {:else if !online.value}
      <div class="card note offline-card" in:enter|global={{ y: 8, duration: dur(200) }}>
        <Icon name="refresh" size={20} />
        <div class="small">
          <div class="note-title">{t('translator.offlineTitle')}</div>
          {t('translator.offline')}
        </div>
      </div>
    {/if}
  </div>

  {#if !input}
    {#if history.length}
      <TranslateHistory items={history} onpick={restore} onremove={remove} onclear={() => void clearAll()} />
    {:else if online.value}
      <p class="hint small muted center" lang={i18n.lang} in:fade={{ duration: dur(150) }}>{t('translator.empty')}</p>
    {/if}
  {/if}
</div>

<style>
  .field-box {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 12px;
  }
  .input-wrap {
    position: relative;
  }
  textarea.text {
    display: block;
    min-height: 120px;
    max-height: 45vh;
    max-height: 45dvh;
    padding-right: 44px;
    resize: none;
    overflow-y: auto;
    font-size: 18px;
    line-height: 1.45;
  }
  .clear {
    position: absolute;
    right: 8px;
    top: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--muted);
    cursor: pointer;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
  }
  .tool {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 0;
    background: none;
    color: var(--accent);
    font-weight: 600;
    font-size: 15px;
    padding: 4px 6px;
    cursor: pointer;
  }
  .count {
    color: var(--muted);
    margin-right: 4px;
    white-space: nowrap;
  }
  .count.bad {
    color: var(--bad);
  }
  .section.first {
    margin-top: 20px;
  }
  .result {
    transition: opacity var(--dur-fast) var(--ease);
  }
  .result.stale {
    opacity: 0.55;
  }
  .main-text {
    margin: 0;
    font-size: 19px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: break-word;
  }
  .result .main-text {
    font-family: var(--font-display);
    font-weight: 700;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 2px;
    margin: 8px -8px -8px 0;
  }
  .via {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  .note-title {
    font-weight: 700;
    margin-bottom: 2px;
  }
  .retry {
    margin-top: 12px;
  }
  .offline-card {
    margin-top: 20px;
  }
  .tap-hint {
    margin: 10px 4px 0;
  }
  .dict {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .dict-row {
    margin: 0;
    line-height: 1.4;
    overflow-wrap: break-word;
  }
  .pos {
    margin-right: 6px;
    color: var(--muted);
    font-family: var(--font-display);
    font-size: 12.5px;
    font-weight: 800;
  }
  .alt {
    cursor: default;
    padding-right: 6px;
  }
  .alt:active {
    background: none;
  }
  .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .alt .title {
    font-weight: 500;
    white-space: pre-wrap;
  }
  .asking {
    margin: 8px 4px 0;
  }
  .def,
  .example {
    cursor: default;
    padding-right: 6px;
  }
  .def:active,
  .example:active {
    background: none;
  }
  .def .title,
  .example .title {
    font-weight: 500;
  }
  .credit {
    margin: 8px 4px 0;
  }
  .hint {
    margin: 22px 12px 0;
    line-height: 1.5;
  }
</style>
