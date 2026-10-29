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
