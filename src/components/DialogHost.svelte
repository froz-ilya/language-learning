<script lang="ts">
  import { fade, fly, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Icon from './Icon.svelte';
  import { ui, type ActionItem, type Dialog } from '../lib/ui/dialogs.svelte';
  import { dur } from '../lib/motion';
  import { openOverlay } from '../lib/ui/overlay';

  /**
   * Renders ui.dialog (promptText / confirmAction / chooseAction). Mounted once in App.
   * Keyed {#each} so an outgoing dialog keeps its content while it animates out, and a new
   * one (e.g. "Rename" from an action sheet opening a prompt) can animate in at the same time.
   */
  let text = $state('');
  let lastDialog: Dialog | null = null;

  $effect.pre(() => {
    const d = ui.dialog;
    if (d && d !== lastDialog && d.kind === 'prompt') text = d.options.value ?? '';
    lastDialog = d;
  });

  // System back (Android) dismisses the dialog like Cancel instead of leaving the page.
  $effect(() => {
    const d = ui.dialog;
    if (!d) return;
    const overlay = openOverlay(() => cancel(d));
    return () => overlay.release();
  });

  function cancel(d: Dialog) {
    if (ui.dialog !== d) return;
    if (d.kind === 'prompt') d.resolve(null);
    else if (d.kind === 'confirm') d.resolve(false);
    else d.resolve();
  }

  function submit(d: Dialog) {
    if (ui.dialog !== d) return;
    if (d.kind === 'prompt') {
      if (text.trim()) d.resolve(text);
    } else if (d.kind === 'confirm') d.resolve(true);
  }

  function pick(d: Dialog, item: ActionItem) {
    if (ui.dialog !== d || d.kind !== 'actions') return;
    // Close first so run() may open another dialog (e.g. a rename prompt).
    d.resolve();
    void item.run();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && ui.dialog) {
      e.preventDefault();
      cancel(ui.dialog);
    }
  }

  function autofocus(el: HTMLInputElement) {
    el.focus();
    el.select();
  }

  function focusPanel(el: HTMLElement) {
    // Move focus into the dialog (for keyboard / VoiceOver) without opening the keyboard.
    if (!el.querySelector('input')) el.focus({ preventScroll: true });
  }
</script>

<svelte:window {onkeydown} />

{#each ui.dialog ? [ui.dialog] : [] as d (d)}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="backdrop"
    class:bottom={d.kind === 'actions'}
    class:top={d.kind === 'prompt'}
    role="presentation"
    transition:fade={{ duration: dur(200) }}
    onclick={(e) => e.target === e.currentTarget && cancel(d)}
  >
    {#if d.kind === 'actions'}
      <div
        class="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={d.title || 'Actions'}
        tabindex="-1"
        {@attach focusPanel}
        transition:fly={{ y: 320, duration: dur(320), easing: cubicOut, opacity: 1 }}
      >
        <div class="group">
          {#if d.title}<div class="sheet-title">{d.title}</div>{/if}
          {#each d.items as item (item)}
            <button class="sheet-item" class:destructive={item.destructive} onclick={() => pick(d, item)}>
              {#if item.icon}<span class="sheet-icon"><Icon name={item.icon} size={20} /></span>{/if}
              <span class="sheet-label">{item.label}</span>
            </button>
          {/each}
        </div>
        <button class="sheet-item cancel" onclick={() => cancel(d)}>Cancel</button>
      </div>
    {:else}
      {@const opts = d.options}
      <div
        class="alert"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabindex="-1"
        {@attach focusPanel}
        in:scale={{ start: 0.92, duration: dur(220), easing: cubicOut }}
        out:fade={{ duration: dur(150) }}
      >
        <form
          onsubmit={(e) => {
            e.preventDefault();
            submit(d);
          }}
        >
          <div class="alert-body">
            <h2 id="dialog-title">{opts.title}</h2>
            {#if opts.message}<p class="message">{opts.message}</p>{/if}
            {#if d.kind === 'prompt'}
              <input
                class="input"
                bind:value={text}
                placeholder={d.options.placeholder ?? ''}
                autocomplete="off"
                autocapitalize="sentences"
                enterkeyhint="done"
                aria-label={opts.title}
                {@attach autofocus}
              />
            {/if}
          </div>
          <div class="alert-buttons">
            <button type="button" class="alert-btn" onclick={() => cancel(d)}>{opts.cancelLabel ?? 'Cancel'}</button>
            {#if d.kind === 'prompt'}
              <button type="submit" class="alert-btn strong" disabled={!text.trim()}>
                {opts.confirmLabel ?? 'OK'}
              </button>
            {:else}
              <button type="submit" class="alert-btn strong" class:destructive={d.options.destructive}>
                {opts.confirmLabel ?? (d.options.destructive ? 'Delete' : 'OK')}
              </button>
            {/if}
          </div>
        </form>
      </div>
    {/if}
  </div>
{/each}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: calc(var(--safe-top) + 16px) 24px calc(var(--safe-bottom) + 16px);
    background: var(--backdrop);
  }
  /* Prompts sit high so the iOS keyboard doesn't cover them. */
  .backdrop.top {
    align-items: flex-start;
    padding-top: calc(var(--safe-top) + 14vh);
  }
  .backdrop.bottom {
    align-items: flex-end;
    padding: 0 8px calc(var(--safe-bottom) + 8px);
  }

  /* ---- Alert (prompt / confirm) ---- */
  .alert {
    width: 100%;
    max-width: 300px;
    background: var(--surface-raised);
    border-radius: 22px;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    outline: none;
  }
  .alert-body {
    padding: 22px 18px 18px;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  h2 {
    font-size: 19px;
  }
  .message {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
  }
  .input {
    margin-top: 10px;
    min-height: 40px;
    padding: 8px 10px;
    text-align: left;
  }
  .alert-buttons {
    display: flex;
    gap: 8px;
    padding: 0 12px 12px;
  }
  .alert-btn {
    flex: 1;
    min-height: 46px;
    border: 0;
    border-radius: 14px;
    background: var(--surface-2);
    color: var(--text);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 17px;
    cursor: pointer;
    transition: background-color var(--dur-fast) var(--ease);
  }
  .alert-btn:active {
    background: var(--surface-3);
  }
  .alert-btn.strong {
    font-weight: 800;
    background: var(--accent-fill);
    color: var(--accent-text);
  }
  .alert-btn.strong:active {
    opacity: 0.85;
  }
  .alert-btn.destructive {
    background: color-mix(in srgb, var(--bad) 18%, var(--surface-2));
    color: var(--bad);
  }
  .alert-btn:disabled {
    opacity: 0.4;
  }

  /* ---- Action sheet ---- */
  .sheet {
    width: 100%;
    max-width: 640px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    outline: none;
    max-height: calc(100dvh - var(--safe-top) - 24px);
  }
  .group {
    background: var(--surface-raised);
    border-radius: 20px;
    box-shadow: var(--shadow-lg);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .sheet-title {
    padding: 14px 16px 12px;
    text-align: center;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
    border-bottom: 0.5px solid var(--border);
  }
  .sheet-item {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    min-height: 56px;
    padding: 10px 16px;
    border: 0;
    background: transparent;
    color: var(--text);
    font-size: 18px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color var(--dur-fast) var(--ease);
  }
  .sheet-item + .sheet-item {
    border-top: 0.5px solid var(--border);
  }
  .sheet-item:active {
    background: var(--surface-2);
  }
  .sheet-icon {
    display: inline-flex;
    color: var(--accent);
  }
  .sheet-item.destructive .sheet-icon {
    color: inherit;
  }
  .sheet-item.destructive {
    color: var(--bad);
  }
  .sheet-item.cancel {
    background: var(--surface-raised);
    border-radius: 20px;
    box-shadow: var(--shadow-lg);
    font-family: var(--font-display);
    font-weight: 800;
    color: var(--accent);
  }
  .sheet-item.cancel:active {
    background: var(--surface-2);
  }
</style>
