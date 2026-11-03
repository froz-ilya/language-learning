import { afterEach, describe, expect, it } from 'vitest';
import { canonicalName, fmtNumber, i18n, locale, resolveUiLang, setUiLang, systemName, t, tn, tParts } from './i18n.svelte';
import { catalogs } from './i18n/messages';

afterEach(() => setUiLang('en'));

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('catalogs', () => {
  const keys = Object.keys(catalogs.en) as (keyof typeof catalogs.en)[];

  it('German has exactly the English keys', () => {
    expect(Object.keys(catalogs.de).sort()).toEqual([...keys].sort());
  });

  it('no message is empty', () => {
    for (const key of keys) {
      expect(catalogs.en[key].trim(), key).not.toBe('');
      expect(catalogs.de[key].trim(), key).not.toBe('');
    }
  });

  it('Russian has the English keys, plus .few and .many for every plural', () => {
    const plurals = keys.filter((k) => k.endsWith('.other')).flatMap((k) => [k.replace(/other$/, 'few'), k.replace(/other$/, 'many')]);
    expect(Object.keys(catalogs.ru).sort()).toEqual([...keys, ...plurals].sort());
    for (const key of Object.keys(catalogs.ru) as (keyof typeof catalogs.ru)[]) expect(catalogs.ru[key].trim(), key).not.toBe('');
  });

  // tn() always fills {n}, so a plural form may leave it out ("A word…") or, since Russian uses
  // `.one` for 21 too, put it in.
  const withoutN = (s: string) => placeholders(s).filter((p) => p !== 'n');
  const isPlural = (key: string) => /\.(one|few|many|other)$/.test(key);

  it('every language uses the same placeholders', () => {
    for (const key of keys) {
      const same = isPlural(key) ? withoutN : placeholders;
      expect(same(catalogs.de[key]), key).toEqual(same(catalogs.en[key]));
      expect(same(catalogs.ru[key]), key).toEqual(same(catalogs.en[key]));
    }
    const ru = catalogs.ru as Record<string, string>;
    for (const key of keys.filter((k) => k.endsWith('.other'))) {
      for (const form of ['few', 'many']) {
        const k = key.replace(/other$/, form);
        expect(withoutN(ru[k]), k).toEqual(withoutN(catalogs.en[key]));
      }
    }
  });

  it('Russian puts the number in every plural form, as .one is also used for 21, 31…', () => {
    const ru = catalogs.ru as Record<string, string>;
    for (const key of Object.keys(ru).filter((k) => /\.(one|few|many)$/.test(k))) {
      const other = catalogs.en[key.replace(/(one|few|many)$/, 'other') as keyof typeof catalogs.en];
      if (other.includes('{n}')) expect(ru[key], key).toContain('{n}');
    }
  });

  it('plural messages come in pairs', () => {
    for (const key of keys) {
      if (key.endsWith('.one')) expect(keys, key).toContain(key.replace(/one$/, 'other'));
    }
  });
});

describe('resolveUiLang', () => {
  it('uses a chosen language whatever the phone says', () => {
    expect(resolveUiLang('de', 'en-US')).toBe('de');
    expect(resolveUiLang('en', 'de-DE')).toBe('en');
    expect(resolveUiLang('ru', 'de-DE')).toBe('ru');
  });

  it('auto follows a German or Russian phone and is English otherwise', () => {
    expect(resolveUiLang('auto', 'de-AT')).toBe('de');
    expect(resolveUiLang('auto', 'DE')).toBe('de');
    expect(resolveUiLang('auto', 'ru-RU')).toBe('ru');
    expect(resolveUiLang('auto', 'uk-UA')).toBe('en');
    expect(resolveUiLang('auto', undefined)).toBe('en');
  });

  it('treats a missing or unknown saved value as auto', () => {
    expect(resolveUiLang(undefined, 'de-DE')).toBe('de');
    expect(resolveUiLang('fr' as never, 'en-GB')).toBe('en');
  });
});

describe('t', () => {
  it('follows the current language', () => {
    expect(t('common.cancel')).toBe('Cancel');
    setUiLang('de');
    expect(i18n.lang).toBe('de');
    expect(t('common.cancel')).toBe('Abbrechen');
  });

  it('fills placeholders', () => {
    expect(t('common.level', { code: 'B1' })).toBe('Level B1');
  });

  it('formats number params for the language', () => {
    expect(fmtNumber(1234)).toBe('1,234');
    setUiLang('de');
    expect(locale()).toBe('de-DE');
    expect(fmtNumber(12345)).toBe('12.345');
  });
});

describe('tn', () => {
  it('picks singular and plural', () => {
    expect(tn('common.words', 1)).toBe('1 word');
    expect(tn('common.words', 0)).toBe('0 words');
    expect(tn('common.words', 2)).toBe('2 words');
    setUiLang('de');
    expect(tn('common.words', 1)).toBe('1 Wort');
    expect(tn('common.words', 12345)).toBe('12.345 Wörter');
  });

  it('uses all Russian plural forms', () => {
    setUiLang('ru');
    expect(tn('common.words', 1)).toBe('1 слово');
    expect(tn('common.words', 3)).toBe('3 слова');
    expect(tn('common.words', 5)).toBe('5 слов');
    expect(tn('common.words', 11)).toBe('11 слов');
    expect(tn('common.words', 21)).toBe('21 слово');
    expect(tn('common.words', 0)).toBe('0 слов');
  });
});

describe('tParts', () => {
  it('returns text around the slots, in the order of the language', () => {
    catalogs.en['common.level'] = 'Level {code} of {all}';
    catalogs.de['common.level'] = '{all}: Niveau {code}';
    try {
      expect(tParts('common.level', { all: 6 })).toEqual([{ text: 'Level ' }, { slot: 'code' }, { text: ' of 6' }]);
      setUiLang('de');
      expect(tParts('common.level')).toEqual([{ slot: 'all' }, { text: ': Niveau ' }, { slot: 'code' }]);
    } finally {
      catalogs.en['common.level'] = 'Level {code}';
      catalogs.de['common.level'] = 'Niveau {code}';
    }
  });
});

describe('system names', () => {
  it('are stored in English whatever the language', () => {
    setUiLang('de');
    expect(canonicalName('reading')).toBe('Reading');
    expect(canonicalName('myWords')).toBe('My words');
    expect(canonicalName('folder:A1')).toBe('A1 · Beginner');
    expect(canonicalName('moved:B2')).toBe('B2 words');
  });

  it('are shown in the current language', () => {
    expect(systemName('Reading')).toBe('Reading');
    setUiLang('de');
    expect(systemName('Reading')).toBe('Lesen');
    expect(systemName('A1 · Beginner')).toBe('A1 · Anfänger');
    expect(systemName('B2 words')).toBe('B2-Wörter');
    expect(systemName('Moved from levels')).toBe('Aus Niveaus verschoben');
    setUiLang('ru');
    expect(systemName('Reading')).toBe('Чтение');
  });

  it('leave names the user gave alone', () => {
    setUiLang('de');
    expect(systemName('Essen & Trinken')).toBe('Essen & Trinken');
    expect(systemName('Reading list')).toBe('Reading list');
  });

  it('leave a set named after an article alone, even when it reads like a German system name', () => {
    expect(systemName('Lesen')).toBe('Lesen');
    setUiLang('de');
    expect(systemName('Lesen')).toBe('Lesen');
  });
});
