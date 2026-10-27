import { db } from './db/schema';
import { exportBackup, shareOrDownload, type ShareResult } from './db/backup';
import { route } from './router.svelte';
import { saveSettings, settings } from './settings.svelte';
import { confirmAction, showToast, ui, type ConfirmOptions } from './ui/dialogs.svelte';
import type { Settings } from './types';

/**
 * Backup reminder: a pop-up on launch when the last backup is older than
 * settings.backupEvery days, plus runBackup() for the "Back up now" buttons.
 */

export const DAY = 24 * 60 * 60 * 1000;

/** Never backed up: remind once there are at least this many own/studied words… */
export const NEVER_BACKED_UP_MIN_WORDS = 20;

export interface DataInfo {
  /** Total cards in the database (0 = nothing to back up). */
  cards: number;
  /** createdAt of the oldest card (epoch ms; 0 when unknown). */
  firstCardAt: number;
  /** Own words + studied words: what would actually hurt to lose (level presets can be reinstalled). */
  worth: number;
}

type ReminderSettings = Pick<Settings, 'backupEvery' | 'lastBackupAt' | 'backupSnoozeUntil'>;

/** Whole days between ts and now (never negative). */
export function daysSince(ts: number, now: number): number {
  return Math.max(0, Math.floor((now - ts) / DAY));
}

/** Pure: should the backup reminder be shown now? */
export function isBackupDue(s: ReminderSettings, now: number, data: DataInfo): boolean {
  const every = s.backupEvery;
  if (!every || every <= 0) return false;
  if (data.cards <= 0) return false;
  if (now < (s.backupSnoozeUntil || 0)) return false;
  if (!s.lastBackupAt) {
    // Never backed up: wait until the data has existed for a while or is worth something.
    const age = data.firstCardAt ? now - data.firstCardAt : 0;
    return age >= every * DAY || data.worth >= NEVER_BACKED_UP_MIN_WORDS;
  }
  return now - s.lastBackupAt >= every * DAY;
}

/** "Last backup: …" wording for Settings. */
export function lastBackupLabel(lastBackupAt: number, now = Date.now()): string {
  if (!lastBackupAt) return 'Never';
  const d = daysSince(lastBackupAt, now);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  return `${d} days ago`;
}

export function backupFilename(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `deutsch-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

async function dataInfo(): Promise<DataInfo> {
  const cards = await db.cards.count();
  if (!cards) return { cards: 0, firstCardAt: 0, worth: 0 };
  // Auto-increment ids: the lowest id is the oldest card.
  const [first, own, studied] = await Promise.all([
    db.cards.toCollection().first(),
    db.cards.where('presetId').equals('').count(),
    db.reviews.count(),
  ]);
  return { cards, firstCardAt: first?.createdAt ?? 0, worth: own + studied };
}

export type BackupResult = ShareResult | 'failed';

let running = false;

/**
 * Export a backup and hand it to the share sheet (or download it). On success records
 * lastBackupAt, clears the snooze and toasts "Backup saved". A cancelled share sheet
 * changes nothing. Pass a pre-built blob promise to keep the share call close to the tap
 * (iOS needs share() to run soon after the user gesture).
 */
export async function runBackup(prepared?: Promise<Blob>): Promise<BackupResult> {
  if (running) return 'cancelled';
  running = true;
  try {
    const blob = await (prepared ?? exportBackup());
    const result = await shareOrDownload(blob, backupFilename());
    if (result !== 'cancelled') {
      settings.lastBackupAt = Date.now();
      settings.backupSnoozeUntil = 0;
      await saveSettings();
      showToast('Backup saved');
    }
    return result;
  } catch (e) {
    console.error('backup failed', e);
    showToast(`Backup failed: ${(e as Error).message}`);
    return 'failed';
  } finally {
    running = false;
  }
}

async function snooze(now: number) {
  settings.backupSnoozeUntil = now + DAY;
  await saveSettings();
}

/** Routes where a pop-up would interrupt a study session. */
const BUSY_ROUTES = ['/learn', '/study', '/placement'];
const FIRST_DELAY = 1500;
const RETRY_DELAY = 5000;
/** Give up waiting for a quiet moment after this long (try again next launch). */
const MAX_WAIT = 30 * 60 * 1000;

let started = false;

function isBusy(): boolean {
  if (ui.dialog) return true;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return true;
  return BUSY_ROUTES.some((p) => route.path === p || route.path.startsWith(`${p}/`));
}

/**
 * Call once after the app mounts. Waits ~1.5 s so the first screen renders, waits out
 * study sessions and open dialogs, then shows the reminder if a backup is due.
 * Shows at most once per app launch.
 */
export function checkBackupReminder(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const startedAt = Date.now();

  const attempt = async () => {
    if (isBusy()) {
      if (Date.now() - startedAt < MAX_WAIT) setTimeout(() => void attempt(), RETRY_DELAY);
      return;
    }
    const now = Date.now();
    let info: DataInfo;
    try {
      info = await dataInfo();
    } catch (e) {
      console.warn('backup reminder: data check failed', e);
      return;
    }
    if (!isBackupDue(settings, now, info)) return;
    // A dialog or session may have opened while we were reading the database.
    if (isBusy()) {
      if (Date.now() - startedAt < MAX_WAIT) setTimeout(() => void attempt(), RETRY_DELAY);
      return;
    }
    await showReminder(now);
  };

  setTimeout(() => void attempt(), FIRST_DELAY);
}

async function showReminder(now: number) {
  const message = settings.lastBackupAt
    ? `Your last backup was ${lastBackupLabel(settings.lastBackupAt, now).toLowerCase()}.`
    : 'You haven’t backed up yet — keep your words safe in iCloud Drive or Files.';
  // Build the backup while the pop-up is open, so "Back up now" can open the share sheet
  // right away (iOS drops the user gesture if share() waits on IndexedDB first).
  const prepared = exportBackup();
  prepared.catch(() => {}); // surfaced by runBackup if used
  // cancelLabel: rendered by DialogHost once ConfirmOptions supports it (falls back to "Cancel").
  const options: ConfirmOptions & { cancelLabel?: string } = {
    title: 'Time for a backup',
    message,
    confirmLabel: 'Back up now',
    cancelLabel: 'Later',
  };
  const ok = await confirmAction(options);
  if (!ok) {
    await snooze(now);
    return;
  }
  const result = await runBackup(prepared);
  // Cancelled share sheet: don't nag again for a day either; lastBackupAt stays unchanged.
  if (result === 'cancelled' || result === 'failed') await snooze(Date.now());
}
