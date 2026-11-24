import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import { checkGerman, checkTranslation } from './answer';

type C = Pick<Card, 'term' | 'pos' | 'genders'>;
const verb = (term: string): C => ({ term, pos: 'verb', genders: [] });

describe('checkGerman: reflexive verbs', () => {
  const sichTreffen = verb('sich treffen');

  it('accepts the dictionary form', () => {
    expect(checkGerman('sich treffen', sichTreffen, 'strict', true)).toEqual({ verdict: 'correct' });
    expect(checkGerman('Sich treffen.', sichTreffen, 'lenient', true)).toEqual({ verdict: 'correct' });
  });

  it('counts a missing "sich" as almost right, in either strictness', () => {
    expect(checkGerman('treffen', sichTreffen, 'lenient', true)).toEqual({ verdict: 'typo', reflexiveProblem: 'missing' });
    expect(checkGerman('treffen', sichTreffen, 'strict', true)).toEqual({ verdict: 'typo', reflexiveProblem: 'missing' });
    // Plus a slip in the verb: still almost right when typos are accepted.
    expect(checkGerman('trefen', sichTreffen, 'lenient', true)).toEqual({ verdict: 'typo', reflexiveProblem: 'missing' });
    expect(checkGerman('trefen', sichTreffen, 'strict', true)).toEqual({ verdict: 'wrong' });
  });

  it('accepts "sich" in front of a bare verb (level words)', () => {
    expect(checkGerman('sich freuen', verb('freuen'), 'strict', true)).toEqual({ verdict: 'correct' });
    expect(checkGerman('freuen', verb('freuen'), 'strict', true)).toEqual({ verdict: 'correct' });
  });

  it('accepts another reflexive pronoun as the reflexive form, with a hint', () => {
    expect(checkGerman('mich treffen', sichTreffen, 'lenient', true)).toEqual({ verdict: 'correct', reflexiveProblem: 'form' });
    expect(checkGerman('uns treffen', sichTreffen, 'strict', true)).toEqual({ verdict: 'correct', reflexiveProblem: 'form' });
    expect(checkGerman('mich freuen', verb('freuen'), 'strict', true)).toEqual({ verdict: 'correct', reflexiveProblem: 'form' });
    expect(checkGerman('sich trefen', sichTreffen, 'lenient', true)).toEqual({ verdict: 'typo' });
  });

  it('still rejects other verbs', () => {
    expect(checkGerman('sich setzen', sichTreffen, 'lenient', true).verdict).toBe('wrong');
    expect(checkGerman('setzen', sichTreffen, 'lenient', true).verdict).toBe('wrong');
    expect(checkGerman('sich', sichTreffen, 'lenient', true).verdict).toBe('wrong');
    expect(checkGerman('sich treffen', verb('setzen'), 'lenient', true).verdict).toBe('wrong');
  });

  it('leaves terms that start with a pronoun alone', () => {
    const term = verb('mir ist kalt');
    expect(checkGerman('mir ist kalt', term, 'strict', true)).toEqual({ verdict: 'correct' });
    expect(checkGerman('ist kalt', term, 'strict', true).verdict).toBe('wrong');
  });

  it('does not touch nouns or the translation direction', () => {
    const tisch: C = { term: 'Tisch', pos: 'noun', genders: ['m'] };
    expect(checkGerman('der Tisch', tisch, 'strict', true)).toEqual({ verdict: 'correct' });
    expect(checkTranslation('встречаться', 'встречаться', 'strict')).toBe('correct');
  });
});

describe('checkGerman: words learned with a preposition', () => {
  const warten = { term: 'warten auf', pos: 'verb' as const, genders: [], preps: 'auf + Akk' };
  const freuen = { term: 'sich freuen über', pos: 'verb' as const, genders: [], preps: 'über + Akk; auf + Akk' };
  const angst = { term: 'Angst vor', pos: 'noun' as const, genders: ['f' as const], preps: 'vor + Dat' };

  it('accepts the word with its preposition, with or without the case', () => {
    for (const a of ['warten auf', 'Warten auf + Akk', 'warten auf (Akk.)', 'warten auf Akkusativ', 'auf jdn. warten', 'warten auf etwas']) {
      expect(checkGerman(a, warten, 'strict', true), a).toEqual({ verdict: 'correct' });
    }
  });

  it('a missing preposition is almost right; another one is wrong; a wrong case is almost right', () => {
    expect(checkGerman('warten', warten, 'strict', true)).toEqual({ verdict: 'typo', prepProblem: 'missing' });
    expect(checkGerman('warten für', warten, 'lenient', true)).toEqual({ verdict: 'wrong', prepProblem: 'wrong' });
    expect(checkGerman('warten auf + Dat', warten, 'strict', true)).toEqual({ verdict: 'typo', prepProblem: 'case' });
    expect(checkGerman('gehen auf', warten, 'lenient', true).verdict).toBe('wrong');
  });

  it('works with "sich" and with articles', () => {
    expect(checkGerman('sich freuen über', freuen, 'strict', true)).toEqual({ verdict: 'correct' });
    expect(checkGerman('sich über etwas freuen', freuen, 'strict', true)).toEqual({ verdict: 'correct' });
    expect(checkGerman('freuen über', freuen, 'strict', true)).toEqual({ verdict: 'typo', reflexiveProblem: 'missing' });
    expect(checkGerman('sich freuen auf', freuen, 'strict', true)).toEqual({ verdict: 'wrong', prepProblem: 'wrong' });
    expect(checkGerman('die Angst vor', angst, 'strict', true)).toEqual({ verdict: 'correct' });
    expect(checkGerman('Angst vor', angst, 'strict', true)).toEqual({ verdict: 'wrong', articleProblem: 'missing' });
    expect(checkGerman('die Angst', angst, 'strict', true)).toEqual({ verdict: 'typo', prepProblem: 'missing' });
  });

  it('a card without the preposition in its term accepts one it goes with', () => {
    expect(checkGerman('warten auf', { ...warten, term: 'warten' }, 'strict', true)).toEqual({ verdict: 'correct' });
    expect(checkGerman('warten mit', { ...warten, term: 'warten' }, 'strict', true).verdict).toBe('wrong');
    // An old phrase card (no matching preps) is compared as typed.
    expect(checkGerman('ab und zu', verb('ab und zu'), 'strict', true)).toEqual({ verdict: 'correct' });
    expect(checkGerman('warten auf', { term: 'warten auf', pos: 'verb', genders: [] }, 'strict', true)).toEqual({ verdict: 'correct' });
  });
});

describe('checkGerman: a preposition that is a detail of the word', () => {
  const denken = { term: 'denken', pos: 'verb' as const, genders: [], preps: 'an + Akk' };
  it('the word alone is right, and so is the word with its preposition', () => {
    expect(checkGerman('denken', denken, 'strict', true)).toEqual({ verdict: 'correct' });
    expect(checkGerman('denken an', denken, 'strict', true)).toEqual({ verdict: 'correct' });
    expect(checkGerman('denken an + Akk', denken, 'strict', true)).toEqual({ verdict: 'correct' });
    expect(checkGerman('an jdn denken', denken, 'strict', true)).toEqual({ verdict: 'correct' });
    expect(checkGerman('denken über', denken, 'strict', true).verdict).toBe('wrong');
  });

  it('a noun with its preposition still says what is wrong with the article', () => {
    const angst = { term: 'Angst', pos: 'noun' as const, genders: ['f' as const], preps: 'vor + Dat' };
    expect(checkGerman('die Angst vor', angst, 'strict', true)).toEqual({ verdict: 'correct' });
    expect(checkGerman('Angst vor', angst, 'strict', true)).toEqual({ verdict: 'wrong', articleProblem: 'missing' });
    expect(checkGerman('der Angst vor', angst, 'strict', true)).toEqual({ verdict: 'wrong', articleProblem: 'wrong' });
  });
});
