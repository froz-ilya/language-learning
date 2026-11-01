import { describe, expect, it } from 'vitest';
import { cardsFor, cardsOfTerm, mergeCards, type CardRef } from './vocab';

const ref = (id: number, term: string): CardRef => ({ id, setId: 1, term, status: 'new' });

describe('cards of the word a sheet shows', () => {
  it('finds a card under the word only a lookup knows, which the text alone can’t', () => {
    const daune = ref(1, 'Daune');
    const vocab = new Map([['daune', [daune]]]);
    // The offline dictionary doesn't know "Daunen": the reader can only go by the text.
    expect(cardsFor('Daunen', new Map([['Daunen', null]]), vocab)).toEqual([]);
    expect(mergeCards([], cardsOfTerm('Daune', vocab))).toEqual([daune]);
  });

  it('lists a card found both ways once, the given ones first', () => {
    const a = ref(1, 'Feder');
    const b = ref(2, 'Feder');
    expect(mergeCards([b], [a, b])).toEqual([b, a]);
    expect(mergeCards([a], [])).toEqual([a]);
  });
});
