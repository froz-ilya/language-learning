<script lang="ts">
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Term from '../components/Term.svelte';
  import { fade, slide } from 'svelte/transition';
  import { dur } from '../lib/motion';
  import { showToast } from '../lib/ui/dialogs.svelte';
  import { systemName, t, tn, tParts } from '../lib/i18n.svelte';
  import { replace, route } from '../lib/router.svelte';
  import { live } from '../lib/live.svelte';
  import { online } from '../lib/online.svelte';
  import { settings } from '../lib/settings.svelte';
  import { db } from '../lib/db/schema';
  import { addSet, allFolders, cardsInSet } from '../lib/db/repo';
  import { displayPlural, displayVerbForms } from '../lib/german/articles';
  import { fillInBackground } from '../lib/fill/runner.svelte';
  import { detectSeparators, parseImport, type ImportRow } from '../lib/import/parse';
  import { markDuplicates, type Duplicate } from '../lib/import/duplicates';
  import { importCards, prefillRows, type Prefill } from '../lib/import/prefill';
  import type { Lang } from '../lib/types';

  const targetSetId = Number(route.query.get('set')) || 0;
  const startFolder = Number(route.query.get('folder')) || 0;
  const backTo = targetSetId ? `/set/${targetSetId}` : startFolder ? `/folder/${startFolder}` : '/library';

  const data = live(async () => ({
    set: targetSetId ? await db.sets.get(targetSetId) : undefined,
    existing: targetSetId ? await cardsInSet(targetSetId) : [],
    folders: await allFolders(),
  }));

  let setName = $state('');
  let folderId = $state(startFolder);

  let text = $state('');
  let termSep = $state<'\t' | ',' | ' - ' | 'custom'>('\t');
  let customTermSep = $state('');
  let rowSep = $state<'\n' | ';' | 'custom'>('\n');
  let customRowSep = $state('');
  let swap = $state(false);
  let autoFill = $state(true);
  /** Once the user picks a separator, stop auto-detecting. */
  let sepTouched = false;

  const PREVIEW_ROWS = 20;

  const rows = $derived<ImportRow[]>(
    parseImport(text, {
      termSep: termSep === 'custom' ? customTermSep : termSep,
      rowSep: rowSep === 'custom' ? customRowSep || '\n' : rowSep,
      swap,
    }).filter((r) => r.parsed.term),
  );

  /** Rows repeating an earlier row, or a word the set already has, are skipped. */
  const dupes = $derived<(Duplicate | null)[]>(markDuplicates(rows, data.value?.existing ?? []));
  const kept = $derived(rows.filter((_, i) => !dupes[i]));
  const skipped = $derived(rows.length - kept.length);

  /**
   * Preview lines: the first rows plus every skipped duplicate further down (so it's clear what
   * is left out), with "…and N more" wherever rows are hidden.
   */
  const previewLines = $derived.by(() => {
    const out: ({ row: ImportRow; i: number } | { more: number })[] = [];
    let last = -1;
    rows.forEach((row, i) => {
      if (i >= PREVIEW_ROWS && !dupes[i]) return;
      if (i > last + 1) out.push({ more: i - last - 1 });
      out.push({ row, i });
      last = i;
    });
    if (rows.length > last + 1) out.push({ more: rows.length - last - 1 });
    return out;
  });

  // ---------- Offline dictionary prefill (articles, plurals, verb forms) ----------

  /** Prefill of the current rows, computed shortly after the text stops changing. */
  let prefilled = $state.raw<{ rows: ImportRow[]; lang: Lang; byRow: Map<ImportRow, Prefill> } | null>(null);

  async function prefillKept(list: ImportRow[], lang: Lang): Promise<Map<ImportRow, Prefill>> {
    if (prefilled?.rows === list && prefilled.lang === lang) return prefilled.byRow;
    const results = await prefillRows(list, lang);
    const byRow = new Map(list.map((r, i) => [r, results[i]]));
    prefilled = { rows: list, lang, byRow };
    return byRow;
  }

  $effect(() => {
    const list = kept;
    const lang = settings.lang;
    if (!list.length) return;
    const timer = setTimeout(() => void prefillKept(list, lang).catch((e) => console.warn('prefill failed', e)), 250);
    return () => clearTimeout(timer);
  });

  function onText() {
    if (sepTouched || !text.trim()) return;
    const d = detectSeparators(text);
    termSep = d.termSep as typeof termSep;
    rowSep = d.rowSep as typeof rowSep;
  }

  function pickTermSep(v: typeof termSep) {
    termSep = v;
    sepTouched = true;
  }
  function pickRowSep(v: typeof rowSep) {
    rowSep = v;
    sepTouched = true;
  }

  /** What the preview shows for a row: with the dictionary's fields once looked up, else as typed. */
  function shown(r: ImportRow): Prefill['fields'] {
    const pf = prefilled?.byRow.get(r)?.fields;
    if (pf) return pf;
    const p = r.parsed;
    return {
      term: p.term,
      translation: r.translation,
      pos: p.pos ?? 'other',
      genders: p.genders,
      plural: p.plural ?? '',
      praeteritum: p.praeteritum ?? '',
      partizip2: p.partizip2 ?? '',
      auxiliary: p.auxiliary ?? '',
    };
  }

  function forms(f: Prefill['fields']): string {
    if (f.pos === 'noun') return displayPlural(f);
    if (f.pos === 'verb') return displayVerbForms(f);
    return '';
  }

  // ---------- Import ----------

  let error = $state('');
  let busy = $state(false);

  async function runImport() {
    error = '';
    if (!kept.length) {
      error = rows.length ? t('words.import.allInSet') : t('words.import.nothingYet');
      return;
    }
    const name = setName.trim();
    if (!targetSetId && !name) {
      error = t('words.import.nameSet');
      document.getElementById('setname')?.focus();
      return;
    }
    busy = true;
    try {
      const list = kept;
      const byRow = await prefillKept(list, settings.lang);
      const setId = targetSetId || (await addSet(name, folderId));
      const cards = importCards(setId, list.map((r) => byRow.get(r)!), autoFill);
      const ids = (await db.cards.bulkAdd(cards, { allKeys: true })) as number[];
      // Open the set right away; examples and anything still missing arrive in the background.
      const toFill = ids.filter((_, i) => cards[i].needsFill);
      if (toFill.length) fillInBackground(setId, toFill);
      replace(`/set/${setId}`);
      const notes = [tn('words.import.imported', cards.length)];
      if (skipped) notes.push(tn('words.import.skipped', skipped));
      showToast(notes.join(' · '));
    } catch (e) {
      error = t('words.import.failed', { message: (e as Error).message });
      busy = false;
    }
  }
</script>

<div class="page">
  <Header
    title={t('words.import.title')}
    subtitle={data.value?.set ? t('words.import.into', { set: data.value.set.topic || systemName(data.value.set.name) }) : t('words.import.subtitle')}
    {backTo}
  />

  <div class="stack">
    <div class="card howto small">
      <div class="step"><span class="num">1</span><span
          >{#each tParts('words.import.step1') as p}{#if p.slot === 'from'}<strong>{t('words.import.fromQuizlet')}</strong>{:else if p.slot === 'export'}<em
                >{t('words.import.menuExport')}</em
              >{:else if p.slot === 'copy'}<em>{t('words.import.menuCopy')}</em>{:else}{p.text}{/if}{/each}</span
        ></div>
      <div class="step"><span class="num">2</span><span>{t('words.import.step2')}</span></div>
      <div class="muted">{t('words.import.understood')}</div>
    </div>

    {#if !targetSetId}
      <div class="field">
        <label for="setname">{t('words.newSet')}</label>
        <input id="setname" class="input" bind:value={setName} placeholder={t('words.import.setName')} />
      </div>
      {#if data.value?.folders.length}
        <div class="field">
          <label for="folder">{t('common.folder')}</label>
          <select id="folder" class="input" bind:value={folderId}>
            <option value={0}>{t('words.import.noFolder')}</option>
            {#each data.value.folders as f}
              <option value={f.id}>{systemName(f.name)}</option>
            {/each}
          </select>
        </div>
      {/if}
    {/if}

    <div class="field">
      <label for="paste">{t('words.import.words')}</label>
      <textarea
        id="paste"
        class="input paste"
        bind:value={text}
        oninput={onText}
        placeholder={'der Tisch\ttable\ngehen, ging, ist gegangen\tto go\nHaus - house'}
        autocapitalize="off"
        autocomplete="off"
        {...{ autocorrect: 'off' }}
        spellcheck="false"
      ></textarea>
    </div>

    <div class="field">
      <span class="label">{t('words.import.betweenTerms')}</span>
      <div class="segmented">
        <button type="button" class:active={termSep === '\t'} onclick={() => pickTermSep('\t')}>{t('words.import.sepTab')}</button>
        <button type="button" class:active={termSep === ','} onclick={() => pickTermSep(',')}>{t('words.import.sepComma')}</button>
        <button type="button" class:active={termSep === ' - '} onclick={() => pickTermSep(' - ')}>{t('words.import.sepDash')}</button>
        <button type="button" class:active={termSep === 'custom'} onclick={() => pickTermSep('custom')}>{t('words.import.sepCustom')}</button>
      </div>
      {#if termSep === 'custom'}
        <input class="input" transition:slide={{ duration: dur(180) }} bind:value={customTermSep} placeholder={t('words.import.customTerm')} autocapitalize="off" autocorrect="off" spellcheck="false" />
      {/if}
    </div>

    <div class="field">
      <span class="label">{t('words.import.betweenRows')}</span>
      <div class="segmented">
        <button type="button" class:active={rowSep === '\n'} onclick={() => pickRowSep('\n')}>{t('words.import.sepNewLine')}</button>
        <button type="button" class:active={rowSep === ';'} onclick={() => pickRowSep(';')}>{t('words.import.sepSemicolon')}</button>
        <button type="button" class:active={rowSep === 'custom'} onclick={() => pickRowSep('custom')}>{t('words.import.sepCustom')}</button>
      </div>
      {#if rowSep === 'custom'}
        <input class="input" transition:slide={{ duration: dur(180) }} bind:value={customRowSep} placeholder={t('words.import.customRow')} autocapitalize="off" autocorrect="off" spellcheck="false" />
      {/if}
    </div>

    <div class="list">
      <label class="list-item toggle">
        <span class="grow">{t('words.import.swap')} <span class="sub">{t('words.import.swapHint')}</span></span>
        <input type="checkbox" class="switch" bind:checked={swap} />
      </label>
      <label class="list-item toggle">
        <span class="grow">
          {t('words.import.fetch')}
          <span class="sub">
            {online.value ? t('words.import.fetchOnline') : t('words.import.fetchOffline')}
          </span>
        </span>
        <input type="checkbox" class="switch" bind:checked={autoFill} />
      </label>
    </div>

    {#if text.trim()}
      <section transition:slide={{ duration: dur(220) }}>
        <h2 class="section-title">
          {t('words.import.preview')}
          <span>
            {tn('common.words', kept.length)}{#if skipped}{` · ${tn('words.import.skipped', skipped)}`}{/if}
          </span>
        </h2>
        {#if rows.length}
          <div class="list preview">
            {#each previewLines as line}
              {#if 'more' in line}
                <div class="list-item more small muted">{tn('words.import.more', line.more)}</div>
              {:else}
                {@const r = line.row}
                {@const i = line.i}
                {@const f = shown(r)}
                {@const lemma = prefilled?.byRow.get(r)?.lemma}
                <div class="list-item prow" class:dup={dupes[i]}>
                  <div class="de">
                    <span class="term"><Term card={f} /></span>
                    {#if lemma}<span class="hint" title={t('words.import.formOf', { lemma })}>→ {lemma}?</span>{/if}
                    {#if dupes[i]}
                      <div class="sub tag">{dupes[i] === 'set' ? t('words.import.inSet') : t('words.import.duplicate')}</div>
                    {:else if forms(f)}
                      <div class="sub">{forms(f)}</div>
                    {/if}
                  </div>
                  <div class="tr" class:muted={!r.translation}>{r.translation || f.translation || (autoFill ? t('words.import.auto') : '—')}</div>
                </div>
              {/if}
            {/each}
          </div>
        {:else}
          <div class="empty">{t('words.import.noWords')}</div>
        {/if}
      </section>
    {/if}

    {#if error}<div class="small bad center" transition:fade={{ duration: dur(150) }}>{error}</div>{/if}

    <button class="btn btn-primary btn-block btn-lg" disabled={busy || !kept.length} onclick={runImport}>
      {#if busy}<span class="spinner"></span>{:else}<Icon name="import" />{/if}
      {kept.length ? tn('words.import.button', kept.length) : rows.length ? t('words.import.nothingNew') : t('words.import.pasteFirst')}
    </button>
  </div>
</div>

<style>
  .howto {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .step {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--accent-fill);
    color: var(--accent-text);
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 900;
    flex-shrink: 0;
  }
  .spinner {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-top-color: transparent;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .paste {
    min-height: 160px;
    font-size: 16px;
    tab-size: 4;
  }
  .toggle {
    cursor: pointer;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .switch {
    width: 26px;
    height: 26px;
    accent-color: var(--accent);
    flex-shrink: 0;
  }
  .prow {
    cursor: default;
    align-items: flex-start;
    min-height: 0;
  }
  .prow:active {
    background: none;
  }
  .de {
    flex: 1;
    min-width: 0;
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .hint {
    margin-left: 6px;
    font-size: 13px;
    font-weight: 400;
    color: var(--muted);
    white-space: nowrap;
  }
  .tr {
    flex: 1;
    min-width: 0;
    text-align: right;
    color: var(--text-2);
    overflow-wrap: break-word;
  }
  .dup {
    opacity: 0.5;
  }
  .dup .term,
  .dup .tr {
    text-decoration: line-through;
  }
  .tag {
    font-style: italic;
  }
  .more {
    justify-content: center;
    min-height: 40px;
  }
</style>
