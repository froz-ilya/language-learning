<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { dur } from '../lib/motion';
  import { ui } from '../lib/ui/dialogs.svelte';

  /**
   * Generic bottom sheet. Drag the handle/header down (or tap the backdrop, or Esc) to close.
   *
   *   <Sheet bind:open title="Filter">…</Sheet>
   */
  let {
    open = $bindable(false),
    title,
    children,
    onclose,
  }: { open?: boolean; title?: string; children: Snippet; onclose?: () => void } = $props();

  let dragY = $state(0);
  let dragging = $state(false);
  let startY = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;

  function close() {
    if (!open) return;
    // dragY is kept so the sheet flies out from where the finger left it.
    open = false;
    onclose?.();
  }

  $effect.pre(() => {
    if (open) dragY = 0;
  });

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    dragging = true;
    startY = lastY = e.clientY;
    lastT = e.timeStamp;
    velocity = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent) {
    if (!dragging) return;
    const dy = e.clientY - startY;
    // Rubber-band upwards, follow the finger downwards.
    dragY = dy > 0 ? dy : -Math.sqrt(-dy) * 2;
    const dt = e.timeStamp - lastT;
    if (dt > 0) velocity = (e.clientY - lastY) / dt;
    lastY = e.clientY;
    lastT = e.timeStamp;
  }

  function up() {
    if (!dragging) return;
    dragging = false;
    if (dragY > 110 || (dragY > 24 && velocity > 0.5)) close();
    else dragY = 0;
  }

  function onkeydown(e: KeyboardEvent) {
    // A dialog opened from inside the sheet handles Esc itself.
    if (open && e.key === 'Escape' && !ui.dialog && !e.defaultPrevented) {
      e.preventDefault();
      close();
    }
  }

  function focusPanel(el: HTMLElement) {
    el.focus({ preventScroll: true });
  }
</script>

<svelte:window {onkeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="sheet-backdrop"
    role="presentation"
    transition:fade={{ duration: dur(220) }}
    onclick={(e) => e.target === e.currentTarget && close()}
  >
    <div
      class="sheet-panel"
      class:dragging
      role="dialog"
      aria-modal="true"
      aria-label={title ?? 'Sheet'}
      tabindex="-1"
      {@attach focusPanel}
      style:transform={dragY ? `translate3d(0, ${dragY}px, 0)` : undefined}
      transition:fly={{ y: 480, duration: dur(320), easing: cubicOut, opacity: 1 }}
    >
      <div
        class="sheet-grip"
        role="presentation"
        onpointerdown={down}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={up}
      >
        <span class="handle" aria-hidden="true"></span>
        {#if title}<h2 class="sheet-heading">{title}</h2>{/if}
      </div>
      <div class="sheet-content">
        {@render children()}
      </div>
    </div>
  </div>
{/if}

<style>
  .sheet-backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: var(--backdrop);
  }
  .sheet-panel {
    width: 100%;
    max-width: 640px;
    max-height: 85vh;
    max-height: 85dvh;
    display: flex;
    flex-direction: column;
    background: var(--surface-raised);
    border-radius: 18px 18px 0 0;
    box-shadow: 0 -8px 32px rgb(0 0 0 / 0.18);
    outline: none;
    transition: transform var(--dur) var(--ease);
  }
  .sheet-panel.dragging {
    transition: none;
  }
  .sheet-grip {
    flex-shrink: 0;
    padding: 8px 16px 4px;
    touch-action: none;
    cursor: grab;
    -webkit-user-select: none;
    user-select: none;
  }
  .handle {
    display: block;
    width: 38px;
    height: 5px;
    margin: 0 auto 8px;
    border-radius: 3px;
    background: var(--border);
  }
  .sheet-heading {
    font-size: 17px;
    font-weight: 600;
    text-align: center;
    padding-bottom: 8px;
  }
  .sheet-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    padding: 4px 16px calc(var(--safe-bottom) + 16px);
  }
  @media (prefers-reduced-motion: reduce) {
    .sheet-panel {
      transition: none;
    }
  }
</style>
