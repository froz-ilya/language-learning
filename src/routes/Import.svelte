<script lang="ts">
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Term from '../components/Term.svelte';
  import { plural } from '../components/library/actions';
  import { fade, slide } from 'svelte/transition';
  import { dur } from '../lib/motion';
  import { showToast } from '../lib/ui/dialogs.svelte';
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
      error = rows.length ? 'These words are all in the set already.' : 'Nothing to import yet — paste your words above.';
      return;
    }
    const name = setName.trim();
    if (!targetSetId && !name) {
      error = 'Give the new set a name.';
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
      const notes = [`Imported ${plural(cards.length, 'word')}`];
      if (skipped) notes.push(`${plural(skipped, 'duplicate')} skipped`);
      showToast(notes.join(' · '));
    } catch (e) {
      error = `Import failed: ${(e as Error).message}`;
      busy = false;
    }
  }
</script>

<div class="page">
  <Header title="Import" subtitle={data.value?.set ? `into “${data.value.set.topic || data.value.set.name}”` : 'Quizlet or word list'} {backTo} />

  <div class="stack">
    <div class="card howto small">
      <div class="step"><span class="num">1</span><span><strong>From Quizlet:</strong> open the set on quizlet.com → ⋯ → <em>Export</em> → <em>Copy text</em>.</span></div>
      <div class="step"><span class="num">2</span><span>Paste it below. A list like “Haus - house”, one word per line, works too.</span></div>
      <div class="muted">“der Tisch” and “gehen, ging, ist gegangen” are understood.</div>
    </div>

    {#if !targetSetId}
      <div class="field">
        <label for="setname">New set</label>
        <input id="setname" class="input" bind:value={setName} placeholder="Set name" />
      </div>
      {#if data.value?.folders.length}
        <div class="field">
          <label for="folder">Folder</label>
          <select id="folder" class="input" bind:value={folderId}>
            <option value={0}>No folder</option>
            {#each data.value.folders as f}
              <option value={f.id}>{f.name}</option>
            {/each}
          </select>
        </div>
      {/if}
    {/if}

    <div class="field">
      <label for="paste">Words</label>
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
      <span class="label">Between word and translation</span>
      <div class="segmented">
        <button type="button" class:active={termSep === '\t'} onclick={() => pickTermSep('\t')}>Tab</button>
        <button type="button" class:active={termSep === ','} onclick={() => pickTermSep(',')}>Comma</button>
        <button type="button" class:active={termSep === ' - '} onclick={() => pickTermSep(' - ')}>“ - ”</button>
        <button type="button" class:active={termSep === 'custom'} onclick={() => pickTermSep('custom')}>Custom</button>
      </div>
      {#if termSep === 'custom'}
        <input class="input" transition:slide={{ duration: dur(180) }} bind:value={customTermSep} placeholder="e.g. =  or  :" autocapitalize="off" autocorrect="off" spellcheck="false" />
      {/if}
    </div>

    <div class="field">
      <span class="label">Between rows</span>
      <div class="segmented">
        <button type="button" class:active={rowSep === '\n'} onclick={() => pickRowSep('\n')}>New line</button>
        <button type="button" class:active={rowSep === ';'} onclick={() => pickRowSep(';')}>Semicolon</button>
        <button type="button" class:active={rowSep === 'custom'} onclick={() => pickRowSep('custom')}>Custom</button>
      </div>
      {#if rowSep === 'custom'}
        <input class="input" transition:slide={{ duration: dur(180) }} bind:value={customRowSep} placeholder="e.g. |" autocapitalize="off" autocorrect="off" spellcheck="false" />
      {/if}
    </div>

    <div class="list">
      <label class="list-item toggle">
        <span class="grow">Swap columns <span class="sub">(translation comes first)</span></span>
        <input type="checkbox" class="switch" bind:checked={swap} />
      </label>
      <label class="list-item toggle">
        <span class="grow">
          Fetch examples & missing details
          <span class="sub">
            {online.value
              ? '(in the background — the set opens right away)'
              : '(in the background once you’re back online)'}
          </span>
        </span>
        <input type="checkbox" class="switch" bind:checked={autoFill} />
      </label>
    </div>

    {#if text.trim()}
      <section transition:slide={{ duration: dur(220) }}>
        <h2 class="section-title">
          Preview
          <span>
            {plural(kept.length, 'word')}{#if skipped}{` · ${plural(skipped, 'duplicate')} skipped`}{/if}
          </span>
        </h2>
        {#if rows.length}
          <div class="list preview">
            {#each previewLines as line}
              {#if 'more' in line}
                <div class="list-item more small muted">…and {line.more} more</div>
              {:else}
                {@const r = line.row}
                {@const i = line.i}
                {@const f = shown(r)}
                {@const lemma = prefilled?.byRow.get(r)?.lemma}
                <div class="list-item prow" class:dup={dupes[i]}>
                  <div class="de">
                    <span class="term"><Term card={f} /></span>
                    {#if lemma}<span class="hint" title="Looks like a form of “{lemma}”">→ {lemma}?</span>{/if}
                    {#if dupes[i]}
                      <div class="sub tag">{dupes[i] === 'set' ? 'already in this set' : 'duplicate'}</div>
                    {:else if forms(f)}
                      <div class="sub">{forms(f)}</div>
                    {/if}
                  </div>
                  <div class="tr" class:muted={!r.translation}>{r.translation || f.translation || (autoFill ? 'auto' : '—')}</div>
                </div>
              {/if}
            {/each}
          </div>
        {:else}
          <div class="empty">No words found — check the separators.</div>
        {/if}
      </section>
    {/if}

    {#if error}<div class="small bad center" transition:fade={{ duration: dur(150) }}>{error}</div>{/if}

    <button class="btn btn-primary btn-block btn-lg" disabled={busy || !kept.length} onclick={runImport}>
      {#if busy}<span class="spinner"></span>{:else}<Icon name="import" />{/if}
      {kept.length ? `Import ${plural(kept.length, 'word')}` : rows.length ? 'Nothing new to import' : 'Paste words to import'}
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
