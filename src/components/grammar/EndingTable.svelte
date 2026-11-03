<script lang="ts">
  import { CASE_NAMES, CASES, endingTable, GENDERS } from '../../lib/grammar/endings';
  import type { Case, Declension, Gender } from '../../lib/grammar/types';

  /**
   * The endings of one declension as sample phrases, a case per row and a gender per column:
   * "den roten", "ein roter", "roter". All German, so the whole table is lang="de". ein has no
   * plural, so that column shows kein ("keine roten"); the caller says so under the table.
   */
  let { declension }: { declension: Declension } = $props();

  /** One adjective for every cell, so only the endings change. */
  const ADJECTIVE = 'rot';

  /** Column heads: the textbook abbreviations, short enough for four columns at phone width. */
  const GENDER_LABELS: Record<Gender, string> = { m: 'mask.', f: 'fem.', n: 'neutr.', pl: 'Plural' };

  function stemOf(g: Gender): string | undefined {
    if (declension === 'der') return 'd';
    if (declension === 'ein') return g === 'pl' ? 'kein' : 'ein';
    return undefined;
  }

  const rows = $derived.by(() => {
    const table = endingTable(declension);
    return CASES.map((c: Case) => ({
      c,
      cells: GENDERS.map((g) => {
        const stem = stemOf(g);
        const det = stem !== undefined && table.det ? stem + table.det[c][g] : undefined;
        return { g, det, ending: table.adj[c][g] };
      }),
    }));
  });
</script>

<table class="endings" lang="de">
  <thead>
    <tr>
      <td></td>
      {#each GENDERS as g}<th scope="col">{GENDER_LABELS[g]}</th>{/each}
    </tr>
  </thead>
  <tbody>
    {#each rows as row (row.c)}
      <tr>
        <th scope="row">{CASE_NAMES[row.c]}</th>
        {#each row.cells as cell (cell.g)}
          <td>
            {#if cell.det}<span class="det">{cell.det}</span>{/if}
            <span class="adj">{ADJECTIVE}<span class="end">{cell.ending}</span></span>
          </td>
        {/each}
      </tr>
    {/each}
  </tbody>
</table>

<style>
  /*
   * Calm on purpose: a lookup table read many times. Only the adjective's ending is marked, as
   * text in the accent colour; the article stays plain. Article and adjective are always two
   * lines, so every cell has the same shape and four columns fit 375px.
   */
  .endings {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    font-size: 14px;
    line-height: 1.5;
  }
  th,
  td {
    padding: 6px 3px;
    text-align: left;
    vertical-align: top;
    overflow-wrap: normal;
  }
  thead th {
    padding-top: 0;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
  }
  thead td,
  th[scope='row'] {
    width: 25%;
  }
  th[scope='row'] {
    padding-left: 0;
    font-size: 13px;
    font-weight: 700;
    color: var(--text-2);
  }
  .det,
  .adj {
    display: block;
    white-space: nowrap;
  }
  .det {
    color: var(--text-2);
  }
  .end {
    color: var(--accent);
    font-weight: 800;
  }
  tbody tr + tr > * {
    border-top: 1px solid var(--hairline);
  }
</style>
