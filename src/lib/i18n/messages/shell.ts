import type { Translation } from './translation';

/** App shell: tab bar, banners, dialogs, toasts, shared widgets. */
export const en = {
  'shell.tab.nav': 'Main',
  'shell.tab.today': 'Today',
  'shell.tab.library': 'Library',
  'shell.tab.levels': 'Levels',
  'shell.tab.read': 'Read',
  'shell.tab.settings': 'Settings',

  'shell.offline': 'Offline — studying works, dictionary auto-fill is paused',
  'shell.levelsUpdated': 'Levels updated to the new word lists. Your progress is kept.',

  'shell.actions': 'Actions',
  'shell.sheet': 'Sheet',
  'shell.loading': 'Loading',
  'shell.pronounce': 'Pronounce',
  'shell.pronounceSlowly': 'Pronounce slowly',
  'shell.progress': '{done} of {total} done',
} as const;

export const de: Translation<typeof en> = {
  'shell.tab.nav': 'Hauptmenü',
  'shell.tab.today': 'Heute',
  'shell.tab.library': 'Bibliothek',
  'shell.tab.levels': 'Niveaus',
  'shell.tab.read': 'Lesen',
  'shell.tab.settings': 'Einstellungen',

  'shell.offline': 'Offline – Lernen geht weiter, automatisches Ausfüllen pausiert',
  'shell.levelsUpdated': 'Niveaus auf die neuen Wortlisten aktualisiert. Dein Fortschritt bleibt erhalten.',

  'shell.actions': 'Aktionen',
  'shell.sheet': 'Bereich',
  'shell.loading': 'Wird geladen',
  'shell.pronounce': 'Aussprechen',
  'shell.pronounceSlowly': 'Langsam aussprechen',
  'shell.progress': '{done} von {total} fertig',
};
