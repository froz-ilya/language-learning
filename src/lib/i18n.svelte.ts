import { catalogs, type Messages, type MsgKey } from './i18n/messages';
import type { LevelCode } from './levels/types';
import type { UiLang, UiLangSetting } from './types';

/**
 * Interface language. Text lives in src/lib/i18n/messages/<area>.ts, English, German and Russian
 * side by side; `t('settings.title')` picks the current language and re-renders when it changes.
 * The language the words are translated into is a separate setting (settings.lang).
 */
const LOCALES: Record<UiLang, string> = { en: 'en-GB', de: 'de-DE', ru: 'ru-RU' };

/** The current language; `lang={i18n.lang}` for interface text inside a `lang="de"` subtree. */
export const i18n = $state({ lang: 'en' as UiLang });

export function setUiLang(lang: UiLang): void {
  i18n.lang = lang;
}

/** 'auto' follows the phone's language (German or Russian on such a phone, else English). */
export function resolveUiLang(choice: UiLangSetting | undefined, deviceLang: string | undefined): UiLang {
  if (choice === 'en' || choice === 'de' || choice === 'ru') return choice;
  const device = deviceLang?.toLowerCase() ?? '';
  return device.startsWith('de') ? 'de' : device.startsWith('ru') ? 'ru' : 'en';
}

/** BCP 47 locale for dates, times and numbers. */
export function locale(): string {
  return LOCALES[i18n.lang];
}

export function fmtNumber(n: number): string {
  return n.toLocaleString(locale());
}

type Placeholders<S> = S extends `${string}{${infer P}}${infer R}` ? P | Placeholders<R> : never;
type ParamValue = string | number;
type ParamsOf<S> = [Placeholders<S>] extends [never] ? [] : [params: Record<Placeholders<S>, ParamValue>];

/** Keys with plural forms: `common.words` for `common.words.one` + `common.words.other`. */
export type PluralKey = MsgKey extends infer K ? (K extends `${infer B}.other` ? B : never) : never;
type PluralMsg<B extends PluralKey> = Messages[`${B}.other` & MsgKey];
type PluralArgs<B extends PluralKey> = [Exclude<Placeholders<PluralMsg<B>>, 'n'>] extends [never]
  ? []
  : [params: Record<Exclude<Placeholders<PluralMsg<B>>, 'n'>, ParamValue>];

const PLACEHOLDER = /\{(\w+)\}/g;

function fill(text: string, params: Record<string, ParamValue> | undefined): string {
  if (!params) return text;
  return text.replace(PLACEHOLDER, (slot, name: string) => {
    const value = params[name];
    return value === undefined ? slot : typeof value === 'number' ? fmtNumber(value) : value;
  });
}

function message(lang: UiLang, key: MsgKey): string {
  return catalogs[lang][key];
}

/** Numbers in `params` are formatted for the language: pass a string for years, ids and the like. */
export function t<K extends MsgKey>(key: K, ...[params]: ParamsOf<Messages[K]>): string {
  return fill(message(i18n.lang, key), params);
}

const pluralRules = new Map<UiLang, Intl.PluralRules>();

/**
 * `tn('common.words', 3)` → "3 words". `{n}` is filled in; other placeholders go in `params`.
 * Russian also has `.few` and `.many` forms; a missing form falls back to `.other`.
 */
export function tn<B extends PluralKey>(key: B, n: number, ...[params]: PluralArgs<B>): string {
  const lang = i18n.lang;
  let rules = pluralRules.get(lang);
  if (!rules) pluralRules.set(lang, (rules = new Intl.PluralRules(LOCALES[lang])));
  const exact = `${key}.${rules.select(n)}` as MsgKey;
  const text = catalogs[lang][exact] ?? message(lang, `${key}.other` as MsgKey);
  return fill(text, { ...(params as Record<string, ParamValue> | undefined), n });
}

export type Part = { text: string; slot?: undefined } | { slot: string; text?: undefined };

/**
 * For a sentence with markup in it, since the words around it differ per language. `params` fill
 * placeholders; the ones left over come back as slots to render:
 *
 *   {#each tParts('settings.restoreFile') as p}
 *     {#if p.slot}<strong>{file}</strong>{:else}{p.text}{/if}
 *   {/each}
 */
export function tParts(key: MsgKey, params?: Record<string, ParamValue>): Part[] {
  const parts: Part[] = [];
  for (const [i, piece] of fill(message(i18n.lang, key), params).split(PLACEHOLDER).entries()) {
    if (i % 2) parts.push({ slot: piece });
    else if (piece) parts.push({ text: piece });
  }
  return parts;
}

// ---------- Names the app itself stores ----------

const LEVEL_CODES: LevelCode[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/**
 * Names the app gives to folders, sets and pasted texts are stored in English in every language:
 * records stay the same whatever the language was when they were made, and code can find them by
 * name. canonicalName() is the stored value, systemName() what to show for it.
 */
function namesIn(lang: UiLang): Record<string, string> {
  const m = catalogs[lang];
  const names: Record<string, string> = {
    myWords: m['system.myWords'],
    reading: m['system.reading'],
    movedFolder: m['system.movedFolder'],
    myText: m['system.myText'],
    ownText: m['system.ownText'],
  };
  for (const code of LEVEL_CODES) {
    names[`folder:${code}`] = `${code} · ${m[`level.${code}.title`]}`;
    names[`moved:${code}`] = fill(m['system.levelWords'], { code });
  }
  return names;
}

export type SystemName = 'myWords' | 'reading' | 'movedFolder' | 'myText' | 'ownText' | `folder:${LevelCode}` | `moved:${LevelCode}`;

export function canonicalName(id: SystemName): string {
  return namesIn('en')[id];
}

let nameIds: Map<string, string> | undefined;

/** The stored name of a folder, set or pasted text for display; a name the user gave stays as it is. */
export function systemName(stored: string): string {
  nameIds ??= new Map(Object.entries(namesIn('en')).map(([id, name]) => [name, id]));
  const id = nameIds.get(stored.trim());
  return id ? namesIn(i18n.lang)[id] : stored;
}
