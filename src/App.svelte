<script lang="ts">
  // ROUTE TABLE (shell agent: keep the routes; restyle the shell — tab bar, transitions, hosts).
  import { route, back, isTabRoot, parentOf } from './lib/router.svelte';
  import { online } from './lib/online.svelte';
  import { ui } from './lib/ui/dialogs.svelte';
  import { reducedMotion } from './lib/motion';
  import { checkBackupReminder } from './lib/backupReminder';
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
  } as const;

  // Backup reminder pop-up (waits for the first screen and any study session; once per launch).
  onMount(checkBackupReminder);

  const Page = $derived(ROUTES[route.parts[0] as keyof typeof ROUTES] ?? Home);
  const onTabRoot = $derived(isTabRoot(route.path));

  /*
   * Edge-swipe back (standalone iOS PWAs have no system back gesture): a touch that starts
   * within EDGE px of the left edge on a non-tab-root page and travels right > TRIGGER px,
   * mostly horizontally, goes back. The page follows the finger at half speed and a back
   * arrow fades in. Elements can opt out with a `data-no-edge-swipe` ancestor.
   */
  const EDGE = 24;
  const TRIGGER = 80;
  let swipe = $state({ active: false, path: '', dx: 0, y: 0 });
  let startX = 0;
  let startY = 0;
  let tracking = false;

  const swipeProgress = $derived(Math.min(1, swipe.dx / TRIGGER));
  // Only applies while we're still on the page the gesture started on, so the new page
  // (rendered inside the view-transition update) never inherits the offset.
  const pageShift = $derived(
    swipe.active && swipe.path === route.path && !reducedMotion() ? Math.min(swipe.dx * 0.5, 160) : 0,
  );

  function reset() {
    tracking = false;
    swipe = { active: false, path: '', dx: 0, y: 0 };
  }

  $effect(() => {
    if (swipe.path && route.path !== swipe.path) reset();
  });

  $effect(() => {
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || isTabRoot(route.path) || ui.dialog) return;
      const t = e.touches[0];
      if (t.clientX > EDGE) return;
      const target = e.target as Element | null;
      if (target?.closest?.('[role="dialog"], [data-no-edge-swipe], input, textarea, select')) return;
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
      swipe = { active: false, path: route.path, dx: 0, y: t.clientY };
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (!swipe.active) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return reset();
        if (dx < -4) return reset();
        if (dx > 10 && dx > Math.abs(dy) * 1.2) swipe.active = true;
        else return;
      }
      if (e.cancelable) e.preventDefault();
      swipe.dx = Math.max(0, dx);
      swipe.y = t.clientY;
    };
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      if (swipe.active && swipe.dx > TRIGGER && e.type === 'touchend') {
        // Keep the offset until the route changes (the transition captures the shifted old
        // page and slides it the rest of the way); the effect below clears it.
        tracking = false;
        back(parentOf(route.path));
        setTimeout(() => !tracking && reset(), 1000);
      } else reset();
    };
    const opts = { passive: false } as const;
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, opts);
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  });
</script>

{#if !online.value}
  <div class="offline">Offline — studying works, dictionary auto-fill is paused</div>
{/if}

<div
  class="route-view"
  class:swiping={pageShift > 0}
  style:transform={pageShift > 0 ? `translate3d(${pageShift}px, 0, 0)` : undefined}
>
  {#key route.path + '?' + route.query.toString()}
    <Page />
  {/key}
</div>

{#if swipe.active && swipe.path === route.path}
  <div
    class="edge-back"
    class:armed={swipeProgress >= 1}
    style:top="{swipe.y - 20}px"
    style:opacity={swipeProgress}
    style:transform="translateX({Math.min(swipe.dx * 0.25, 24) - 8}px) scale({0.6 + 0.4 * swipeProgress})"
    aria-hidden="true"
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
  </div>
{/if}

{#if onTabRoot}
  <TabBar />
{/if}

<ToastHost />
<DialogHost />

<style>
  .offline {
    position: sticky;
    top: 0;
    z-index: 10;
    padding: calc(var(--safe-top) + 4px) 16px 4px;
    background: var(--warn);
    color: #000;
    font-size: 13px;
    font-weight: 600;
    text-align: center;
    view-transition-name: offline-banner;
  }
  .route-view {
    min-height: 100vh;
    min-height: 100dvh;
  }
  .route-view.swiping {
    background: var(--bg);
    box-shadow: -10px 0 24px rgb(0 0 0 / 0.12);
    will-change: transform;
  }
  .edge-back {
    position: fixed;
    left: 8px;
    z-index: 40;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--surface);
    color: var(--muted);
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.15);
    pointer-events: none;
    transition:
      background-color var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease);
  }
  .edge-back.armed {
    background: var(--accent);
    color: var(--accent-text);
  }
</style>
