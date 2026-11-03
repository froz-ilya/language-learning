<script lang="ts">
  import { db } from '../lib/db/schema';
  import { t } from '../lib/i18n.svelte';
  import { live } from '../lib/live.svelte';
  import { reducedMotion } from '../lib/motion';
  import { route, switchTab } from '../lib/router.svelte';

  /** iOS-style bottom tab bar, shown on the five tab roots (App.svelte decides). */
  const TABS = [
    {
      path: '/',
      label: 'shell.tab.today',
      // sun
      icon: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    },
    {
      path: '/library',
      label: 'shell.tab.library',
      // books
      icon: 'M4 19V5a1 1 0 011-1h3a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1zM9 7h4a1 1 0 011 1v11a1 1 0 01-1 1H9M15.5 6.6l2.9-.8a1 1 0 011.2.7l3 11.2a1 1 0 01-.7 1.2l-2.9.8a1 1 0 01-1.2-.7l-3-11.2a1 1 0 01.7-1.2z',
    },
    {
      path: '/levels',
      label: 'shell.tab.levels',
      // ascending bars
      icon: 'M4 20v-5M10 20v-9M16 20V8M22 20V4',
    },
    {
      path: '/grammar',
      label: 'shell.tab.grammar',
      // words either side of the verb
      icon: 'M3 9h7v6H3zM14 9h7v6h-7zM12 5v14',
    },
    {
      path: '/read',
      label: 'shell.tab.read',
      // open book
      icon: 'M2 5.5A1.5 1.5 0 013.5 4H9a3 3 0 013 3v13a2.5 2.5 0 00-2.5-2.5H3.5A1.5 1.5 0 012 16zM22 5.5A1.5 1.5 0 0020.5 4H15a3 3 0 00-3 3v13a2.5 2.5 0 012.5-2.5h6a1.5 1.5 0 001.5-1.5z',
    },
  ] as const;

  /** The only signal of due grammar outside its tab: Today stays words only. */
  const grammarDue = live(() => {
    void route.path; // read synchronously: sentences fall due with time, so re-check on each move
    return db.grammar.where('due').belowOrEqual(Date.now()).count();
  });

  function select(path: string) {
    if (route.path === path) {
      // Tapping the active tab scrolls back to the top, like iOS.
      window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    switchTab(path);
  }
</script>

<nav class="app-tabbar" aria-label={t('shell.tab.nav')}>
  {#each TABS as tab (tab.path)}
    {@const active = route.path === tab.path}
    <a
      href="#{tab.path}"
      class="tab"
      class:active
      aria-current={active ? 'page' : undefined}
      onclick={(e) => {
        e.preventDefault();
        select(tab.path);
      }}
    >
      <span class="pill"><svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width={active ? 2.2 : 1.8}
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d={tab.icon} />
      </svg>{#if tab.path === '/grammar' && grammarDue.value}<span class="due-dot" role="img" aria-label={t('grammar.dueDot')}></span>{/if}</span>
      <span>{t(tab.label)}</span>
    </a>
  {/each}
</nav>

<style>
  .app-tabbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 30;
    display: flex;
    justify-content: center;
    padding: 6px max(8px, env(safe-area-inset-left, 0px)) calc(var(--safe-bottom) + 2px)
      max(8px, env(safe-area-inset-right, 0px));
    min-height: var(--tabbar-h);
    background: var(--chrome-bg);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    backdrop-filter: saturate(180%) blur(20px);
    box-shadow: inset 0 1px 0 var(--hairline);
  }
  .tab {
    flex: 1;
    max-width: 160px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    min-height: 48px;
    color: var(--muted);
    text-decoration: none;
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.02em;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    transition:
      color var(--dur-fast) var(--ease),
      transform var(--dur-fast) var(--ease);
  }
  .tab:active {
    transform: scale(0.92);
  }
  .pill {
    position: relative;
    display: grid;
    place-items: center;
    width: 54px;
    height: 30px;
    border-radius: 999px;
    transition: background-color var(--dur) var(--ease);
  }
  .due-dot {
    position: absolute;
    top: 3px;
    right: 12px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-bar);
  }
  .tab.active {
    color: var(--accent);
  }
  .tab.active .pill {
    background: var(--accent-soft);
  }
  .tab:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -4px;
    border-radius: var(--radius-sm);
  }
  @media (prefers-reduced-motion: reduce) {
    .tab {
      transition: none;
    }
    .tab:active {
      transform: none;
    }
  }
</style>
