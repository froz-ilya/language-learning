import type { RuTranslation, Translation } from './translation';

/** App shell: tab bar, banners, dialogs, toasts, shared widgets. */
export const en = {
  'shell.tab.nav': 'Main',
  'shell.tab.today': 'Today',
  'shell.tab.library': 'Library',
  'shell.tab.levels': 'Levels',
  'shell.tab.grammar': 'Grammar',
  'shell.tab.read': 'Read',

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
  'shell.tab.grammar': 'Grammatik',
  'shell.tab.read': 'Lesen',

  'shell.offline': 'Offline – Lernen geht weiter, automatisches Ausfüllen pausiert',
  'shell.levelsUpdated': 'Niveaus auf die neuen Wortlisten aktualisiert. Dein Fortschritt bleibt erhalten.',

  'shell.actions': 'Aktionen',
  'shell.sheet': 'Bereich',
  'shell.loading': 'Wird geladen',
  'shell.pronounce': 'Aussprechen',
  'shell.pronounceSlowly': 'Langsam aussprechen',
  'shell.progress': '{done} von {total} fertig',
};

export const ru: RuTranslation<typeof en> = {
  'shell.tab.nav': 'Главное меню',
  'shell.tab.today': 'Сегодня',
  'shell.tab.library': 'Библиотека',
  'shell.tab.levels': 'Уровни',
  'shell.tab.grammar': 'Грамматика',
  'shell.tab.read': 'Чтение',

  'shell.offline': 'Офлайн — учиться можно, автозаполнение из словаря на паузе',
  'shell.levelsUpdated': 'Уровни обновлены до новых списков слов. Твой прогресс сохранён.',

  'shell.actions': 'Действия',
  'shell.sheet': 'Панель',
  'shell.loading': 'Загрузка',
  'shell.pronounce': 'Произнести',
  'shell.pronounceSlowly': 'Произнести медленно',
  'shell.progress': 'Готово {done} из {total}',
};
