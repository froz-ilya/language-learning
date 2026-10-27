import { db } from './db/schema';
import type { Settings } from './types';

export const defaultSettings: Settings = {
  id: 'main',
  lang: 'ru',
  voiceURI: '',
  rate: 0.9,
  autoplay: true,
  strictness: 'lenient',
  requireArticle: true,
  direction: 'mixed',
  newPerSession: 10,
  focus: '',
  backupEvery: 7,
  lastBackupAt: 0,
  backupSnoozeUntil: 0,
  theme: 'auto',
  vibration: true,
};

export const settings = $state<Settings>({ ...defaultSettings });

export async function loadSettings(): Promise<void> {
  const saved = await db.settings.get('main');
  if (saved) Object.assign(settings, { ...defaultSettings, ...saved });
}

export function saveSettings(): Promise<unknown> {
  return db.settings.put($state.snapshot(settings));
}
