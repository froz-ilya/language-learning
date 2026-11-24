import { describe, expect, it } from 'vitest';
import { translationForPick } from './pickTranslation';

describe('translationForPick', () => {
  const haus = [['дом', 'здание'], ['домашнее хозяйство']];

  it('selects only the meaning holding the typed word', () => {
    expect(translationForPick(haus, 'дом', 'ru', 'ru')).toEqual({
      meanings: haus,
      picked: [true, false],
      prepended: false,
    });
    expect(translationForPick(haus, 'домашнее хозяйство', 'ru', 'ru')?.picked).toEqual([false, true]);
  });

  it('puts the typed word in front when the dictionary lacks it', () => {
    expect(translationForPick(haus, 'жилище', 'ru', 'ru')).toEqual({
      meanings: [['жилище'], ...haus],
      picked: [true, false, false],
      prepended: true,
    });
    expect(translationForPick([], ' жилище ', 'ru', 'ru')?.meanings).toEqual([['жилище']]);
  });

  it('ignores a word typed in another language than the translations', () => {
    expect(translationForPick([['house']], 'house', 'en', 'ru')).toBeNull();
    expect(translationForPick(haus, 'дом', 'ru', 'en')).toBeNull();
    expect(translationForPick(haus, '  ', 'ru', 'ru')).toBeNull();
  });

  it('matches regardless of ё/е, stress marks and case', () => {
    const m = [['ёлка'], ['за́мок', 'крепость']];
    expect(translationForPick(m, 'елка', 'ru', 'ru')?.picked).toEqual([true, false]);
    expect(translationForPick(m, 'Замок', 'ru', 'ru')?.picked).toEqual([false, true]);
    expect(translationForPick([['House', 'home']], 'house', 'en', 'en')?.picked).toEqual([true]);
  });
});
