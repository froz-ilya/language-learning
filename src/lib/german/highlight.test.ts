import { describe, expect, it } from 'vitest';
import { markExample, type LemmaOf } from './highlight';

type Forms = Parameters<typeof markExample>[1];

const verb = (term: string, praeteritum = '', partizip2 = ''): Forms => ({ term, pos: 'verb', plural: '', praeteritum, partizip2 });
const noun = (term: string, plural = ''): Forms => ({ term, pos: 'noun', plural, praeteritum: '', partizip2: '' });
const adj = (term: string): Forms => ({ term, pos: 'adj', plural: '', praeteritum: '', partizip2: '' });

/** The marked words, in order. */
async function marked(sentence: string, card: Forms, lemmaOf?: LemmaOf) {
  const parts = await markExample(sentence, card, lemmaOf);
  expect(parts.map((p) => p.text).join('')).toBe(sentence);
  return parts.filter((p) => p.hit).map((p) => p.text);
}

const lemmas: Record<string, string> = { fährt: 'fahren', fuhr: 'fahren', Häuser: 'Haus', stand: 'stehen' };
const lemmaOf: LemmaOf = async (t) => lemmas[t] ?? null;

describe('markExample', () => {
  it('marks stored verb forms and regular present forms', async () => {
    const gehen = verb('gehen', 'ging', 'gegangen');
    expect(await marked('Ich ging gestern ins Kino.', gehen)).toEqual(['ging']);
    expect(await marked('Er ist nach Hause gegangen.', gehen)).toEqual(['gegangen']);
    expect(await marked('Wohin gehst du? Er geht mit.', gehen)).toEqual(['gehst', 'geht']);
  });

  it('does not mark other words that only share the stem', async () => {
    expect(await marked('Das gehört mir.', verb('gehen', 'ging', 'gegangen'))).toEqual([]);
    expect(await marked('Die Hausaufgabe ist schwer.', noun('Haus', 'Häuser'))).toEqual([]);
  });

  it('marks noun forms, any case, and the plural', async () => {
    const haus = noun('Haus', 'Häuser');
    expect(await marked('Das Haus ist alt. Die Häuser sind neu.', haus)).toEqual(['Haus', 'Häuser']);
    expect(await marked('Die Farbe des Hauses.', haus)).toEqual(['Hauses']);
    expect(await marked('Haus und haus', haus)).toEqual(['Haus', 'haus']);
  });

  it('uses the dictionary for irregular forms', async () => {
    expect(await marked('Sie fährt nach Berlin.', verb('fahren'))).toEqual([]);
    expect(await marked('Sie fährt nach Berlin.', verb('fahren'), lemmaOf)).toEqual(['fährt']);
  });

  it('marks both parts of a separable verb', async () => {
    const aufstehen = verb('aufstehen', 'stand auf', 'aufgestanden');
    expect(await marked('Ich stehe um sieben Uhr auf.', aufstehen)).toEqual(['stehe', 'auf']);
    expect(await marked('Er stand früh auf.', aufstehen, lemmaOf)).toEqual(['stand', 'auf']);
    expect(await marked('Ich bin früh aufgestanden.', aufstehen)).toEqual(['aufgestanden']);
    expect(await marked('Wann willst du aufstehen?', aufstehen)).toEqual(['aufstehen']);
  });

  it('marks adjective endings', async () => {
    expect(await marked('Ein schönes Haus, die schönsten Tage.', adj('schön'))).toEqual(['schönes', 'schönsten']);
  });

  it('marks each word of a several-word term, not sich', async () => {
    expect(await marked('Ich freue mich auf dich.', verb('sich freuen'))).toEqual(['freue']);
  });

  it('survives a failing dictionary', async () => {
    const broken: LemmaOf = async () => {
      throw new Error('offline');
    };
    expect(await marked('Sie fährt weg.', verb('fahren'), broken)).toEqual([]);
  });
});
