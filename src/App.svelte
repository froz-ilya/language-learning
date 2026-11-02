<script lang="ts">
  // ROUTE TABLE (shell agent: keep the routes; restyle the shell — tab bar, transitions, hosts).
  import { route, isTabRoot } from './lib/router.svelte';
  import { online } from './lib/online.svelte';
  import { showToast } from './lib/ui/dialogs.svelte';
  import { checkBackupReminder } from './lib/backupReminder';
  import { syncLevels } from './lib/levels/sync';
  import { translateArticleExamples } from './lib/reading/exampleTranslations';
  import { settings } from './lib/settings.svelte';
  import { t } from './lib/i18n.svelte';
  import { onMount } from 'svelte';
  import TabBar from './components/TabBar.svelte';
  import DialogHost from './components/DialogHost.svelte';
  import ToastHost from './components/ToastHost.svelte';
  import Home from './routes/Home.svelte';
  import Library from './routes/Library.svelte';
  import Levels from './routes/Levels.svelte';
  import LevelPage from './routes/LevelPage.svelte';
  import FolderPage from './routes/FolderPage.svelte';
  import SetPage from './routes/SetPage.svelte';
  import CardEditor from './routes/CardEditor.svelte';
  import Learn from './routes/Learn.svelte';
  import LearnSetup from './routes/LearnSetup.svelte';
  import Study from './routes/Study.svelte';
  import Placement from './routes/Placement.svelte';
  import Import from './routes/Import.svelte';
  import Settings from './routes/Settings.svelte';
  import Read from './routes/Read.svelte';
  import Reader from './routes/Reader.svelte';
  import PasteText from './routes/PasteText.svelte';
  import HardWords from './routes/HardWords.svelte';
  import Share from './routes/Share.svelte';
  import Search from './routes/Search.svelte';

  /*
   * Routes (hash based). Tab roots (show the bottom tab bar): /, /library, /levels, /settings.
   *   /                         Today: one big "Start" (smart session over smart/today), shortcuts
   *   /library                  Library: user folders + unfiled sets, progress bars
   *   /levels                   Levels: A1…C2 cards with progress rings
   *   /level/:code              Level: topic sets, progress, Learn level, placement check
   *   /folder/:id               Folder: its sets, "Learn all"
   *   /set/:id                  Set: word list, statuses, learn, add, import
   *   /card/new?set=:id         Quick add a word
   *   /card/:id                 Edit word
   *   /learn/:kind/:id          Smart session (kind = set | folder | level | smart)
   *   /modes/:kind/:id          "More ways to study": pick a single mode
   *   /study/:kind/:id/:mode    Single-mode session
   *   /placement/:code          Placement check for a level
   *   /import?set=:id|folder=:id  Quizlet / bulk paste import
   *   /settings                 Settings + backup
   *   /read                     Read: articles by level, saved, paste your own
   *   /article/:source/:id      Reader (tap words → add to the article's set)
   *   /paste                    Paste your own text into the reader
   *   /hard                     Hard words: missed 5+ times, practice + memory hooks
   *   /share?term=:word         Android share target: picks a set, then → /card/new?set=…&term=…
   *   /search                   Quick word search (German, English, Russian → German), add to a set optionally
   * Route components read route.parts / route.query themselves.
   */
  const ROUTES = {
    library: Library,
    levels: Levels,
    level: LevelPage,
    folder: FolderPage,
    set: SetPage,
    card: CardEditor,
    learn: Learn,
    modes: LearnSetup,
    study: Study,
    placement: Placement,
    import: Import,
    settings: Settings,
    read: Read,
    article: Reader,
    paste: PasteText,
    hard: HardWords,
    share: Share,
    search: Search,
  } as const;

  // Backup reminder pop-up (waits for the first screen and any study session; once per launch).
  onMount(checkBackupReminder);

  // Installed levels follow the word lists of this release; progress stays with the words.
  onMount(async () => {
    if (await syncLevels(settings.lang)) showToast(t('shell.levelsUpdated'));
  });

  // Example sentences of words added from a text: those added offline, once the network is back.
  $effect(() => {
    if (online.value) void translateArticleExamples(settings.lang);
  });

  const Page = $derived(ROUTES[route.parts[0] as keyof typeof ROUTES] ?? Home);
  const onTabRoot = $derived(isTabRoot(route.path));
</script>

{#if !online.value}
  <div class="offline">{t('shell.offline')}</div>
{/if}

<div class="route-view">
  {#key route.path + '?' + route.query.toString()}
    <Page />
  {/key}
</div>

{#if onTabRoot}
  <TabBar />
{/if}

<ToastHost />
<DialogHost />

<style>
  .offline {
    position: sticky;
    top: 0;
    z-index: 26;
    padding: calc(var(--safe-top) + 4px) 16px 4px;
    background: var(--warn);
    color: var(--on-tone);
    font-size: 13px;
    font-weight: 600;
    text-align: center;
    view-transition-name: offline-banner;
  }
  .route-view {
    min-height: 100vh;
    min-height: 100dvh;
  }
</style>
