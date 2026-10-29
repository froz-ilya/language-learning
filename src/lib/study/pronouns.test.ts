import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import { blankPronoun, isPronounCard, pronounOptions, pronounQuestion } from './pronouns';
import { modeApplies, modeAvailability } from './session';

function card(term: string, examples: string[], extra: Partial<Card> = {}): Card {
  return {
    id: 1,
    setId: 1,
    term,
    translation: 'x',
    pos: 'verb',
    genders: [],
    plural: '',
    praeteritum: '',
    partizip2: '',
    auxiliary: '',
    examples: examples.map((de) => ({ de, tr: 'перевод' })),
    notes: '',
    starred: 0,
    needsFill: 0,
    known: 0,
    presetId: '',
    createdAt: 0,
    ...extra,
  };
}

describe('pronounQuestion', () => {
  it('blanks the pronoun that goes with the verb', () => {
    const q = pronounQuestion(card('sich freuen', ['Ich freue mich auf dich.']));
    expect(q).toMatchObject({ before: 'Ich freue ', after: ' auf dich.', text: 'mich', pronoun: 'mich' });
    expect(q?.example.tr).toBe('перевод');
  });

  it('works for a reflexive term without a subject or a found verb form', () => {
    expect(pronounQuestion(card('sich beeilen', ['Beeil dich!']))?.pronoun).toBe('dich');
    expect(pronounQuestion(card('sich treffen', ['Wir trafen uns im Park.']))?.pronoun).toBe('uns');
  });

  it('takes the first example that has a pronoun', () => {
    const c = card('sich treffen', ['Treffen ist schön.', 'Wir treffen uns morgen.']);
    expect(pronounQuestion(c)).toMatchObject({ before: 'Wir treffen ', pronoun: 'uns' });
  });

  it('for a bare verb needs a pronoun agreeing with the subject next to the verb', () => {
    expect(isPronounCard(card('freuen', ['Ich freue mich.']))).toBe(true);
    expect(isPronounCard(card('freuen', ['Er hat sich sehr gefreut.']))).toBe(true);
    expect(isPronounCard(card('treffen', ['Wir trafen uns im Park.'], { praeteritum: 'traf' }))).toBe(true);
    // Object pronouns are not reflexive.
    expect(isPronounCard(card('sehen', ['Ich sehe dich.']))).toBe(false);
    expect(isPronounCard(card('warten', ['Ich warte auf dich.']))).toBe(false);
    expect(isPronounCard(card('helfen', ['Kannst du mir helfen?']))).toBe(false);
    // Not a verb, no example, no pronoun.
    expect(isPronounCard(card('Freude', ['Ich freue mich.'], { pos: 'noun' }))).toBe(false);
    expect(isPronounCard(card('sich freuen', []))).toBe(false);
    expect(isPronounCard(card('sich freuen', ['Freude ist schön.']))).toBe(false);
  });

  it('matches whole words only', () => {
    expect(blankPronoun({ de: 'Die Mischung ist gut.' }, card('sich mischen', []))).toBeNull();
  });
});

describe('pronounOptions', () => {
  it('has the answer, the other case of the same person and no duplicates', () => {
    for (let i = 0; i < 20; i++) {
      const o = pronounOptions('mich');
      expect(o).toHaveLength(4);
      expect(new Set(o).size).toBe(4);
      expect(o).toContain('mich');
      expect(o).toContain('mir');
    }
    const s = pronounOptions('sich');
    expect(s).toContain('sich');
    expect(s).toContain('uns');
    expect(s).toContain('euch');
  });
});

describe('pronouns mode', () => {
  it('applies to cards with a question and says why when none', () => {
    const ok = card('sich freuen', ['Ich freue mich.']);
    const no = card('gehen', ['Ich gehe.']);
    expect(modeApplies('pronouns', ok)).toBe(true);
    expect(modeApplies('pronouns', no)).toBe(false);
    expect(modeAvailability('pronouns', [ok, no])).toEqual({ count: 1 });
    expect(modeAvailability('pronouns', [no]).reason).toBe('No reflexive verbs with an example');
  });
});
