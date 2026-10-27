import type { IconName } from '../../components/Icon.svelte';
import { restoreSnapshot, type Snapshot } from '../db/repo';

/**
 * In-app replacements for prompt()/confirm() plus toasts. Rendered by <DialogHost/> and
 * <ToastHost/> in App.svelte; call these from anywhere.
 *
 *   const name = await promptText({ title: 'New set', placeholder: 'Set name' });
 *   if (await confirmAction({ title: 'Reset progress?', destructive: true })) …
 *   chooseAction('Set', [{ label: 'Rename', icon: 'edit', run: rename }, …]);
 *   undoToast('Set deleted', await deleteSet(id));
 */

export interface PromptOptions {
  title: string;
  message?: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Label of the dismiss button (default "Cancel"), e.g. "Later". */
  cancelLabel?: string;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  /** Label of the dismiss button (default "Cancel"), e.g. "Later". */
  cancelLabel?: string;
  destructive?: boolean;
}

export interface ActionItem {
  label: string;
  icon?: IconName;
  destructive?: boolean;
  run: () => void | Promise<void>;
}

export type Dialog =
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'actions'; title: string; items: ActionItem[]; resolve: () => void };

export interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  timeout: number;
}

export const ui = $state({
  dialog: null as Dialog | null,
  toasts: [] as Toast[],
});

export function promptText(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    ui.dialog = { kind: 'prompt', options, resolve: (v) => ((ui.dialog = null), resolve(v?.trim() || null)) };
  });
}

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    ui.dialog = { kind: 'confirm', options, resolve: (ok) => ((ui.dialog = null), resolve(ok)) };
  });
}

/** Bottom action sheet; resolves after it closes (an item's run() is called first). */
export function chooseAction(title: string, items: ActionItem[]): Promise<void> {
  return new Promise((resolve) => {
    ui.dialog = { kind: 'actions', title, items, resolve: () => ((ui.dialog = null), resolve()) };
  });
}

let nextToast = 1;

export function showToast(message: string, opts: { actionLabel?: string; onAction?: () => void; timeout?: number } = {}) {
  const toast: Toast = { id: nextToast++, message, timeout: 5000, ...opts };
  ui.toasts = [...ui.toasts.slice(-2), toast];
  setTimeout(() => dismissToast(toast.id), toast.timeout);
}

export function dismissToast(id: number) {
  ui.toasts = ui.toasts.filter((t) => t.id !== id);
}

/** "Deleted · Undo" toast that restores what a delete removed. */
export function undoToast(message: string, snapshot: Snapshot) {
  showToast(message, { actionLabel: 'Undo', onAction: () => void restoreSnapshot(snapshot) });
}
