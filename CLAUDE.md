# Deutsch lernen — notes for Claude

Personal German-vocabulary PWA for iPhone (also Android). Svelte 5 (runes) + TypeScript + Vite +
Dexie (IndexedDB) + vite-plugin-pwa. No backend; deployed to GitHub Pages from `main`
(base path `/language-learning/`).

## Commands

```bash
npm run dev      # dev server
npm test         # vitest (includes database migration tests)
npm run check    # svelte-check, must stay at 0 errors / 0 warnings
npm run build    # production build
npm run data:levels && npm run data:dict && npm run data:reading   # rebuild generated data from caches
node scripts/dict/reverse.mjs   # only the RU/EN → DE reverse index (public/dict/rev) from public/dict
```

## User data must stay compatible (hard rule)

The user's words, progress and settings live only on their phone. Every update must open data
saved by any earlier version without losing anything. If a change can't be compatible, it needs a
migration that is tested.

- **IndexedDB (src/lib/db/schema.ts):** never edit or remove an existing `this.version(n)` block.
  Add `this.version(n + 1)` with `.upgrade()` that fills defaults for new fields or converts
  data. Only add tables/indexes; never rename or drop a table or a field that holds user data.
- **New fields** on stored records (Card, WordSet, Folder, Review, SavedArticle): give them a
  default in the upgrade step, or make them optional and read them with a fallback.
- **Settings:** add new fields to `defaultSettings`; `loadSettings()` merges saved values over
  defaults, so older saved settings keep working. Never change the meaning of an existing value.
- **localStorage:** read every key inside try/catch and validate it; unknown or missing values
  fall back to a default.
- **Stored formats** (e.g. translations "meaning 1; meaning 2", lookup cache rows): old values
  must still read correctly. Caches may be versioned (cache key prefix, see `CACHE_VERSION` in
  src/lib/lookup/lookup.ts) and cleared in an upgrade step; user-made data may not be dropped.
- **Backups:** `importBackup()` must accept every older backup version (normalize old records).
- **Level presets:** word ids (`A1:Haus`) must stay stable across data rebuilds; progress is tied
  to them.
- **Tests:** every schema version or stored-format change adds a case to
  src/lib/db/migration.test.ts that creates the *old* database exactly as that version stored
  it and checks it opens correctly. Old schema snapshots there are never edited.

## Conventions

- UI: shared tokens/classes in src/styles/app.css (light + dark themes via `html[data-theme]`).
  Motion goes through `dur()` (src/lib/motion.ts) so Reduce Motion is respected.
- No native `prompt/confirm/alert`: use src/lib/ui/dialogs.svelte.ts.
- Online sources go through the fallback chains in src/lib/sources; don't work around a source
  that rate-limits or blocks — back off.
- Generated data (public/levels, public/dict, public/reading) is committed; download caches under
  `scripts/*/.cache` are gitignored.

## Local environment quirks

- npm's default cache isn't writable here: use
  `npm_config_cache=<scratchpad>/npm-cache npm …`.
- The desktop app's preview launcher can't start servers in ~/Documents: run
  `npx vite --port 5173 --strictPort --host 127.0.0.1` from Bash in the background and attach with
  the `dev-attach` config in .claude/launch.json.
