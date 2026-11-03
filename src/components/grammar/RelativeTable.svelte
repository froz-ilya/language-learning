<script lang="ts">
  import { CASE_NAMES, CASES, definiteArticle, GENDER_NAMES, GENDERS, relativePronoun } from '../../lib/grammar/endings';

  /**
   * The relative pronouns, a case per row and a gender per column. All German, so the whole table
   * is lang="de". The forms that aren't the article (denen, dessen, deren) are marked: they are
   * the ones to learn, so they come from comparing with the article, not from a list.
   */
  const rows = CASES.map((c) => ({
    c,
    cells: GENDERS.map((g) => {
      const word = relativePronoun(c, g);
      return { g, word, differs: word !== definiteArticle(c, g) };
    }),
  }));
</script>

<table class="pronouns" lang="de">
  <thead>
    <tr>
      <td></td>
      {#each GENDERS as g}<th scope="col">{GENDER_NAMES[g]}</th>{/each}
    </tr>
  </thead>
  <tbody>
    {#each rows as row (row.c)}
      <tr>
        <th scope="row">{CASE_NAMES[row.c]}</th>
        {#each row.cells as cell (cell.g)}
          <td class:differs={cell.differs}>{cell.word}</td>
        {/each}
      </tr>
    {/each}
  </tbody>
</table>

<style>
  /* Calm like the ending tables: only the forms that aren't the article are marked, as text. */
  .pronouns {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    font-size: 15px;
    line-height: 1.5;
  }
  th,
  td {
    padding: 6px 3px;
    text-align: left;
    vertical-align: baseline;
    white-space: nowrap;
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
  td {
    color: var(--text);
  }
  .differs {
    color: var(--accent);
    font-weight: 700;
  }
  tbody tr + tr > * {
    border-top: 1px solid var(--hairline);
  }
</style>
