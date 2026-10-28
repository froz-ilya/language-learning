// Incremental catalog update (scripts/reading/lib/update.mjs) on recorded Klexikon API responses.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourcesFromRows } from '../../../scripts/reading/lib/catalog.mjs';
import { applyChanges, rowsOf, siteChanges, summaryTitle, updateCatalog } from '../../../scripts/reading/lib/update.mjs';

type Params = Record<string, string>;
type Row = { level: string; words: number };
type Page = { title: string; wikitext: string };

const F = JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__/klexikon-changes.json'), 'utf8'));

/** Answers like the API from the fixture; records every request. */
function fakeApi(fixture = F) {
  const calls: Params[] = [];
  const get = async (p: Params) => {
    calls.push(p);
    if (p.list === 'recentchanges') return p.rccontinue ? fixture.recentchanges[1] : fixture.recentchanges[0];
    if (p.list === 'logevents') return p.letype === 'delete' ? fixture.delete : fixture.move;
    if (p.titles) {
      const titles = p.titles.split('|');
      const pages = titles.map((t) => fixture.pages.find((x: Page) => x.title === t) ?? { ns: 0, title: t, missing: true });
      return { batchcomplete: true, query: { pages } };
    }
    throw new Error(`unexpected request ${JSON.stringify(p)}`);
  };
  return { get, calls };
}

const EMPTY = {
  recentchanges: [{ batchcomplete: true, query: { recentchanges: [] } }],
  delete: { batchcomplete: true, query: { logevents: [] } },
  move: { batchcomplete: true, query: { logevents: [] } },
  pages: [],
};

/** Stub rating: every fetched page rates A2, its length as the word count. */
const rate = async (page: Page) => ({ title: page.title, level: 'A2', words: page.wikitext.length });

const ROWS = new Map<string, Row>([
  ['Sushi', { level: 'B1', words: 100 }],
  ['Volt', { level: 'A2', words: 80 }],
  ['Vatikan', { level: 'B1', words: 200 }],
  ['Bündnis Sahra Wagenknecht', { level: 'B2', words: 300 }],
  ['Dämon', { level: 'A2', words: 150 }],
  ['Hund', { level: 'A1', words: 120 }],
]);
const SINCE = '2026-07-30T00:00:00Z';

describe('siteChanges', () => {
  it('asks for recent changes and the delete/move logs since the sync time, following continue', async () => {
    const { get, calls } = fakeApi();
    const events = await siteChanges(get, SINCE);
    expect(calls).toHaveLength(4);
    expect(calls[0]).toMatchObject({
      list: 'recentchanges',
      rcnamespace: '0',
      rctype: 'new|edit',
      rcdir: 'newer',
      rcstart: '2026-07-30T00:00:01Z', // start is inclusive: one second after the last sync
      maxlag: '5',
    });
    expect(calls[1].rccontinue).toBe('20261001000000|1');
    expect(calls[2]).toMatchObject({ list: 'logevents', letype: 'delete', lenamespace: '0', lestart: '2026-07-30T00:00:01Z' });
    expect(calls[3]).toMatchObject({ list: 'logevents', letype: 'move', lenamespace: '0' });
    // Oldest first; deleting a redirect to make room for a move is not an article deletion.
    expect(events.map((e: { timestamp: string }) => e.timestamp)).toEqual(events.map((e: { timestamp: string }) => e.timestamp).sort());
    expect(events.filter((e: { type: string }) => e.type === 'delete').map((e: { title: string }) => e.title)).toEqual(['Dämon']);
    expect(events.filter((e: { type: string }) => e.type === 'move')).toEqual([
      expect.objectContaining({ title: 'Vatikan', to: 'Vatikanstadt', toNs: 0 }),
      expect.objectContaining({ title: 'Bündnis Sahra Wagenknecht', to: 'Bündnis Soziale Gerechtigkeit und Wirtschaftliche Vernunft', toNs: 0 }),
      expect.objectContaining({ title: 'Harry Kane', to: 'Entwurf:Harry Kane', toNs: 320 }),
    ]);
  });
});

describe('applyChanges', () => {
  it('adds new pages, re-rates edited ones, removes deleted pages and redirects, keeps rows of renamed pages', async () => {
    const { get, calls } = fakeApi();
    const events = await siteChanges(get, SINCE);
    calls.length = 0;
    const r = await applyChanges(ROWS, events, { get, rate });

    // One batched request for every page that changed. ("Harry Kane" was moved to the drafts, then
    // edited at its old title again, so it is checked too; the fixture has it as missing.)
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ prop: 'info|revisions', rvprop: 'content|timestamp', rvslots: 'main' });
    expect(calls[0].titles.split('|').sort()).toEqual(['Celsius', 'Harry Kane', 'Hawaiianer', 'Katzen', 'Sushi', 'Volt']);

    expect(r.changes.added.sort()).toEqual(['Celsius', 'Katzen']);
    expect(r.changes.removed.sort()).toEqual(['Dämon', 'Volt']); // deleted; turned into a redirect
    expect(r.changes.renamed).toEqual([
      ['Vatikan', 'Vatikanstadt'],
      ['Bündnis Sahra Wagenknecht', 'Bündnis Soziale Gerechtigkeit und Wirtschaftliche Vernunft'],
    ]);
    expect(r.changes.updated).toEqual(['Sushi']);
    expect(r.rows.get('Vatikanstadt')).toEqual({ level: 'B1', words: 200 });
    expect(r.rows.get('Hund')).toEqual({ level: 'A1', words: 120 });
    expect(r.rows.has('Hawaiianer')).toBe(false); // a new redirect, not an article
    expect(r.rows.has('Harry Kane')).toBe(false); // not an article (missing in the fixture)
    expect(r.newest).toBe(events[events.length - 1].timestamp);
  });

  it('a page edited into a stub leaves the catalog', async () => {
    const { get } = fakeApi();
    const events = await siteChanges(get, SINCE);
    const r = await applyChanges(ROWS, events, { get, rate: async (p: Page) => (p.title === 'Sushi' ? null : rate(p)) });
    expect(r.changes.removed).toContain('Sushi');
  });

  it('nothing to do: no page requests', async () => {
    const { get, calls } = fakeApi(EMPTY);
    const r = await applyChanges(ROWS, await siteChanges(get, SINCE), { get, rate });
    expect(calls).toHaveLength(3);
    expect(r.changes).toEqual({ added: [], removed: [], renamed: [], updated: [] });
    expect(r.newest).toBeNull();
  });
});

describe('updateCatalog', () => {
  const committed = (since: string) => ({
    version: 1,
    generated: '2026-10-01',
    license: 'CC BY-SA 4.0',
    sync: { klexikon: since },
    sources: { klexikon: sourcesFromRows(ROWS) },
  });
  const sites = [{ id: 'klexikon', name: 'Klexikon' }];

  it('returns the updated catalog, the new sync time and a change log', async () => {
    const { get } = fakeApi();
    const r = await updateCatalog(committed(SINCE), { sites, getFor: () => get, rate, now: Date.parse('2026-10-28T12:00:00Z'), today: '2026-10-28' });
    expect(r.catalog).not.toBeNull();
    expect(r.catalog!.generated).toBe('2026-10-28');
    expect(r.catalog!.sync.klexikon > SINCE).toBe(true);
    const rows = rowsOf(r.catalog!.sources.klexikon);
    expect([...rows.keys()].sort()).toEqual(
      ['Bündnis Soziale Gerechtigkeit und Wirtschaftliche Vernunft', 'Celsius', 'Hund', 'Katzen', 'Sushi', 'Vatikanstadt'].sort(),
    );
    expect(r.totals).toEqual({ added: 2, removed: 2, renamed: 2, updated: 1 });
    expect(r.log).toContain('- Klexikon: renamed “Vatikan” → “Vatikanstadt”');
    expect(r.log).toContain('- Klexikon: removed “Dämon”');
    expect(summaryTitle(r.totals)).toBe('Update reading list (2 new, 2 removed, 2 renamed, 1 re-rated)');
  });

  it('nothing changed: no catalog to write (the file stays byte-identical)', async () => {
    const { get } = fakeApi(EMPTY);
    const r = await updateCatalog(committed(SINCE), { sites, getFor: () => get, rate });
    expect(r.catalog).toBeNull();
  });

  it('only edits that change nothing: the sync time moves on only when it gets old', async () => {
    // Every listed page is unchanged: the rating gives back exactly the committed rows.
    const same = async (p: Page) => ({ title: p.title, ...(ROWS.get(p.title) ?? { level: 'A2', words: 1 }) });
    const onlyEdits = { ...F, recentchanges: [{ query: { recentchanges: F.recentchanges.flatMap((x: { query: { recentchanges: { title: string }[] } }) => x.query.recentchanges).filter((x: { title: string }) => x.title === 'Sushi') } }], delete: EMPTY.delete, move: EMPTY.move };
    const recent = await updateCatalog(committed('2026-08-01T00:00:00Z'), { sites, getFor: () => fakeApi(onlyEdits).get, rate: same, now: Date.parse('2026-08-20T00:00:00Z') });
    expect(recent.catalog).toBeNull();
    const old = await updateCatalog(committed('2026-08-01T00:00:00Z'), { sites, getFor: () => fakeApi(onlyEdits).get, rate: same, now: Date.parse('2026-10-28T00:00:00Z') });
    expect(old.catalog?.sync.klexikon).toBe('2026-08-16T09:25:55Z');
    expect(old.totals).toEqual({ added: 0, removed: 0, renamed: 0, updated: 0 });
  });

  it('needs a sync time', async () => {
    await expect(updateCatalog({ version: 1, sources: {} }, { sites, getFor: () => fakeApi().get, rate })).rejects.toThrow(/--full/);
  });
});
