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
- **Level presets:** word ids (`A1:Haus`) never change across data rebuilds, even when a word
  changes level (`A1:Waffe` is a B2 word); progress is tied to them and the level is the file a
  word is in. `node scripts/levels/check-ids.mjs` must pass. When a rebuild moves words, raise
  `DATA_VERSION` in scripts/levels/build.mjs: `syncLevels()` (src/lib/levels/sync.ts) then updates
  installed levels at launch, keeping everything the user made of a word.
- **Tests:** every schema version or stored-format change adds a case to
  src/lib/db/migration.test.ts that creates the *old* database exactly as that version stored
  it and checks it opens correctly. Old schema snapshots there are never edited.

## Conventions

- UI: shared tokens/classes in src/styles/app.css (light + dark themes via `html[data-theme]`).
  Motion goes through `dur()` (src/lib/motion.ts) so Reduce Motion is respected. Blocks on a page
  enter with `in:enter|global`, not `fly`: they stay still while the page itself is moving.
- Swipes between pages are iOS's own and can't be changed. Don't add a custom edge swipe, and don't
  animate a move the system already animated (src/lib/ui/systemSwipe.ts).
- No native `prompt/confirm/alert`: use src/lib/ui/dialogs.svelte.ts.
- Online sources go through the fallback chains in src/lib/sources; don't work around a source
  that rate-limits or blocks — back off.
- Generated data (public/levels, public/dict, public/reading) is committed; download caches under
  `scripts/*/.cache` are gitignored.
- News (src/lib/reading/sources/tagesschau.ts, dw.ts) isn't open-licensed: the phone fetches it
  from the publisher. Its text never goes into public/, the repository or a workflow, and test
  fixtures are invented text. tagesschau allows 60 requests an hour, so keep the limits in
  `loadNews()` (src/lib/reading/feed.svelte.ts).
- Levels: A1–B1 are the Goethe-Zertifikat lists (DWDS, rows mapped by scripts/levels/goethe.json:
  DWDS lacks most of the PDFs' group lists, which `extra` restores). Use only which word is at which
  level; Goethe's example sentences are protected. No official list exists above B1, so B2–C2 are
  estimates (scripts/levels/lib/graded.mjs): compounds of listed words are B2 (`notCompound` holds
  the hand-checked exceptions), then DAFlex (CC BY-NC-SA: keep the credit), then frequency.

## Grammar

Word-order lessons, separate from word cards: authored data in src/lib/grammar/content, logic in
practice.ts and path.ts (pure), progress per exercise in `db.grammar` (included in backups).

- Three word-order groups (topics), each with small steps (`GRAMMAR_STAGES`). A stage stays inside
  one group, so one rule covers all its words; words that get confused across groups meet through
  `partners`. Stages are lists of words: changing them needs no migration.
- A right answer raises an exercise's box only when it is due, so "learned" means right on two
  different days.
- The cheat sheet (/grammar/cheat) is for lookups during homework: everything visible, no tapping
  to open anything, jumps are instant.

- Exercise ids (`weil-3`) never change or get reused: progress is tied to them.
- A `build` exercise lists every order a German speaker would accept in `answers`, with the same
  words in each. A correct order marked wrong is the worst bug here. src/lib/grammar/content.test.ts
  checks the data.
- Sentences are invented for this app. Rule text is `RuleText` in the content, not an i18n key, and
  follows the interface language (`x[i18n.lang]`). Sentence translations and word meanings follow `settings.lang`, like word cards.

## Interface language

The interface is in English, German and Russian (`settings.uiLang`: auto, en, de, ru; auto follows
the phone).
That's separate from `settings.lang`, the language words are translated into (ru, en).

- Text the user can see never goes in code: it's a key in src/lib/i18n/messages/<area>.ts, with
  English, German and Russian side by side. Russian plurals also need `.few` and `.many`
  (`RuTranslation`). `npm run check` fails on a missing or unknown key, and
  src/lib/i18n.test.ts on different placeholders. German words and example sentences being taught
  (`der/die/das`, `Präteritum`, topic names) aren't interface text.
- `t('key', { name })` in .svelte and .ts; `tn('common.words', n)` for counts; `tParts` when a
  sentence has markup in it. Never build a sentence from pieces: word order differs. Numbers and
  dates go through `fmtNumber()` and `locale()`, and interface text inside a `lang="de"` subtree
  gets `lang={i18n.lang}`.
- `t()` is reactive, but a value computed once is not. Module-level constants that are read later
  become getters or functions; values computed in a component stay fresh because a page is
  rebuilt on navigation, except on the Settings page and in the tab bar (use `$derived`).
- Names the app gives to folders, sets and pasted texts are stored in English in every language
  (`canonicalName()`), and code finds them by those names. Show them through `systemName()`,
  wherever a folder or set name is displayed. Never store a `t()` value.
- The data scripts load src/lib/reading/{rate,wikitext,text}.ts and what they import through Vite
  without the Svelte plugin, so those files and src/lib/levels/types.ts can't import i18n.svelte
  (src/lib/reading/catalog.test.ts fails if one does).
- German uses informal "du", no gendered forms beyond what's already there, and these terms:
  Set/Sets, Ordner, Bibliothek, Niveau/Niveaus, Karte, Karteikarten, Wort/Wörter, Übersetzung,
  Bedeutung, Beispiel(satz), Artikel, Nomen, Verb, Adjektiv, Aussprache, Stimme, wiederholen,
  fällig, gelernt, schwere Wörter, Fehler, Sitzung, Backup, wiederherstellen, Quelle, Wörterbuch,
  Lesen, Text, offline. German strings run longer: check narrow rows and buttons at phone width.
- Russian uses informal "ты", no gendered past tense about the user, and these terms: набор, папка,
  библиотека, уровень, карточка, слово, перевод, значение, пример, артикль (der/die/das) vs.
  статья (a text), существительное, глагол, прилагательное, произношение, голос, повторять,
  к повторению, выучено, трудные слова, ошибки, занятие, резервная копия, восстановить, источник,
  словарь, Чтение, текст, офлайн.

## Local environment quirks

- npm's default cache isn't writable here: use
  `npm_config_cache=<scratchpad>/npm-cache npm …`.
- The desktop app's preview launcher can't start servers in ~/Documents: run
  `npx vite --port 5173 --strictPort --host 127.0.0.1` from Bash in the background and attach with
  the `dev-attach` config in .claude/launch.json.
