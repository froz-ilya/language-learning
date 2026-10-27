<script lang="ts">
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Term from '../components/Term.svelte';
  import FillProgress from '../components/library/FillProgress.svelte';
  import { plural } from '../components/library/actions';
  import { fade, slide } from 'svelte/transition';
  import { dur } from '../lib/motion';
  import { showToast } from '../lib/ui/dialogs.svelte';
  import { replace, route } from '../lib/router.svelte';
  import { live } from '../lib/live.svelte';
  import { online } from '../lib/online.svelte';
  import { settings } from '../lib/settings.svelte';
  import { db } from '../lib/db/schema';
  import { addCards, addSet, allFolders, emptyCard } from '../lib/db/repo';
  import { displayPlural, displayVerbForms } from '../lib/german/articles';
  import { fillCards } from '../lib/lookup/lookup';
  import { detectSeparators, parseImport, type ImportRow } from '../lib/import/parse';
  import type { Card } from '../lib/types';

  const targetSetId = Number(route.query.get('set')) || 0;
  const startFolder = Number(route.query.get('folder')) || 0;
  const backTo = targetSetId ? `/set/${targetSetId}` : startFolder ? `/folder/${startFolder}` : '/library';

  const data = live(async () => ({
    set: targetSetId ? await db.sets.get(targetSetId) : undefined,
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
  let autoFill = $state(online.value);
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

  function forms(r: ImportRow): string {
    const p = r.parsed;
    if (p.plural) return displayPlural({ plural: p.plural });
    if (p.praeteritum || p.partizip2)
      return displayVerbForms({ praeteritum: p.praeteritum ?? '', partizip2: p.partizip2 ?? '', auxiliary: p.auxiliary ?? '' });
    return '';
  }

  // ---------- Import ----------

  let error = $state('');
  let busy = $state(false);
  let progress = $state<{ done: number; total: number } | null>(null);
  let ctrl: AbortController | undefined;

  async function runImport() {
    error = '';
    if (!rows.length) {
      error = 'Nothing to import yet — paste your words above.';
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
      const setId = targetSetId || (await addSet(name, folderId));
      const fill = autoFill && online.value;
      const count = rows.length;
      const now = Date.now();
      const cards: Card[] = rows.map((r, i) => {
        const p = r.parsed;
        return {
          ...emptyCard(setId),
          term: p.term,
          translation: r.translation,
          pos: p.pos ?? 'other',
          genders: p.genders,
          plural: p.plural ?? '',
          praeteritum: p.praeteritum ?? '',
          partizip2: p.partizip2 ?? '',
          auxiliary: p.auxiliary ?? '',
          needsFill: autoFill ? 1 : 0,
          createdAt: now + i, // keep the pasted order
        };
      });
      await addCards(cards);

      if (fill) {
        const toFill = await db.cards
          .where('setId')
          .equals(setId)
          .filter((c) => c.needsFill === 1 && c.createdAt >= now)
          .toArray();
        ctrl = new AbortController();
        progress = { done: 0, total: toFill.length };
        try {
          await fillCards(toFill, settings.lang, (done, total) => (progress = { done, total }), ctrl.signal);
        } catch (e) {
          // Not fatal: the set page offers "Fill now" for whatever is left.
          if (!ctrl.signal.aborted) console.warn('auto-fill failed', e);
        }
      }
      replace(`/set/${setId}`);
      showToast(`Imported ${plural(count, 'word')}`);
    } catch (e) {
      error = `Import failed: ${(e as Error).message}`;
      busy = false;
      progress = null;
    }
  }

  function cancelFill() {
    ctrl?.abort();
  }

  $effect(() => () => ctrl?.abort());
</script>

<div class="page">
  <Header title="Import" subtitle={data.value?.set ? `into “${data.value.set.topic || data.value.set.name}”` : 'Quizlet or word list'} {backTo} />

  {#if progress}
    <div class="stack" in:fade={{ duration: dur(200) }}>
      <FillProgress
        done={progress.done}
        total={progress.total}
        label="Imported {rows.length} words. Filling in details…"
        oncancel={cancelFill}
      />
      <p class="small muted center">You can cancel — the rest can be filled later from the set page.</p>
    </div>
  {:else}
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
            Auto-fill articles, plurals, verb forms & examples
            <span class="sub">{online.value ? '(online)' : '(offline — will be filled later from the set page)'}</span>
          </span>
          <input type="checkbox" class="switch" bind:checked={autoFill} />
        </label>
      </div>

      {#if text.trim()}
        <section transition:slide={{ duration: dur(220) }}>
          <h2 class="section-title">
            Preview
            <span>{rows.length} {rows.length === 1 ? 'word' : 'words'}</span>
          </h2>
          {#if rows.length}
            <div class="list preview">
              {#each rows.slice(0, PREVIEW_ROWS) as r}
                <div class="list-item prow">
                  <div class="de">
                    <Term card={{ term: r.parsed.term, pos: r.parsed.pos ?? 'other', genders: r.parsed.genders }} />
                    {#if forms(r)}<div class="sub">{forms(r)}</div>{/if}
                  </div>
                  <div class="tr" class:muted={!r.translation}>{r.translation || (autoFill ? 'auto' : '—')}</div>
                </div>
              {/each}
              {#if rows.length > PREVIEW_ROWS}
                <div class="list-item more small muted">…and {rows.length - PREVIEW_ROWS} more</div>
              {/if}
            </div>
          {:else}
            <div class="empty">No words found — check the separators.</div>
          {/if}
        </section>
      {/if}

      {#if error}<div class="small bad center" transition:fade={{ duration: dur(150) }}>{error}</div>{/if}

      <button class="btn btn-primary btn-block btn-lg" disabled={busy || !rows.length} onclick={runImport}>
        {#if busy}<span class="spinner"></span>{:else}<Icon name="import" />{/if}
        {rows.length ? `Import ${plural(rows.length, 'word')}` : 'Paste words to import'}
      </button>
    </div>
  {/if}
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
    background: var(--accent);
    color: var(--accent-text);
    font-size: 13px;
    font-weight: 700;
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
    accent-color: var(--good);
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
  .tr {
    flex: 1;
    min-width: 0;
    text-align: right;
    overflow-wrap: anywhere;
  }
  .more {
    justify-content: center;
    min-height: 40px;
  }
</style>
