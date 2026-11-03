import type { UiLang } from '../types';
import * as common from './messages/common';
import * as grammar from './messages/grammar';
import * as library from './messages/library';
import * as reading from './messages/reading';
import * as settings from './messages/settings';
import * as shell from './messages/shell';
import * as study from './messages/study';
import * as words from './messages/words';

/** One flat catalog per language, made of one file per area of the app. */
const en = { ...common.en, ...shell.en, ...settings.en, ...library.en, ...study.en, ...words.en, ...reading.en, ...grammar.en };

export type Messages = typeof en;
export type MsgKey = keyof Messages;

const de: Record<MsgKey, string> = {
  ...common.de,
  ...shell.de,
  ...settings.de,
  ...library.de,
  ...study.de,
  ...words.de,
  ...reading.de,
  ...grammar.de,
};

export const catalogs: Record<UiLang, Record<MsgKey, string>> = { en, de };
