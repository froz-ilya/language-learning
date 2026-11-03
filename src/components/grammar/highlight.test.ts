import { describe, expect, it } from 'vitest';
import { endingSegments, highlightSegments } from './highlight';

const marked = (text: string, connector?: string, verbs?: string[], answer?: string) =>
  highlightSegments(text, connector, verbs, answer)
    .map((s) => (s.kind ? `[${s.kind}:${s.text}]` : s.text))
    .join('');

describe('highlightSegments', () => {
  it('marks the connector and the verb, and keeps all the text', () => {
    expect(marked('Ich bleibe hier, weil es regnet.', 'weil', ['regnet'])).toBe('Ich bleibe hier, [c:weil] es [v:regnet].');
  });

  it('matches the connector whatever its case', () => {
    expect(marked('Weil es regnet, bleibe ich.', 'weil', ['regnet', 'bleibe'])).toBe('[c:Weil] es [v:regnet], [v:bleibe] ich.');
  });

  it('matches whole words only', () => {
    expect(marked('Das Weiltal ist schön, weil es weit ist.', 'weil', ['ist'])).toBe('Das Weiltal ist schön, [c:weil] es weit [v:ist].');
    expect(marked('Heute ist es heiß.', '', ['es'])).toBe('Heute ist [v:es] heiß.');
  });

  it('looks for a verb from the connector onward', () => {
    expect(marked('Er ist müde, weil er krank ist.', 'weil', ['ist'])).toBe('Er ist müde, [c:weil] er krank [v:ist].');
  });

  it('marks a verb that stands only before the connector', () => {
    expect(marked('Ich bleibe hier, weil es regnet.', 'weil', ['bleibe'])).toBe('Ich [v:bleibe] hier, [c:weil] es regnet.');
  });

  it('searches the whole sentence when the connector is missing', () => {
    expect(marked('Er ist müde.', 'weil', ['ist'])).toBe('Er [v:ist] müde.');
  });

  it('marks several verbs, in any order, and the same verb twice', () => {
    expect(marked('Ich weiß, dass er arbeiten muss.', 'dass', ['muss', 'arbeiten'])).toBe('Ich weiß, [c:dass] er [v:arbeiten] [v:muss].');
    expect(marked('Sie hat gesagt, dass sie Zeit hat und Geld hat.', 'dass', ['hat', 'hat'])).toBe(
      'Sie hat gesagt, [c:dass] sie Zeit [v:hat] und Geld [v:hat].',
    );
  });

  it('marks no verb without a list, and leaves out one that is not there', () => {
    expect(marked('Er bleibt, weil er muss.', 'weil')).toBe('Er bleibt, [c:weil] er muss.');
    expect(marked('Er bleibt.', 'weil', ['geht'])).toBe('Er bleibt.');
  });

  it('marks the answer as well as the connector, and once when they are the same word', () => {
    expect(marked('Wenn du Fragen hast, dann ruf mich an!', 'wenn', ['hast', 'ruf'], 'dann')).toBe(
      '[c:Wenn] du Fragen [v:hast], [c:dann] [v:ruf] mich an!',
    );
    expect(marked('Weil es regnet, bleibe ich.', 'weil', ['regnet'], 'weil')).toBe('[c:Weil] es [v:regnet], bleibe ich.');
    expect(marked('Weil es regnet, weil es kalt ist.', 'weil', [], 'weil')).toBe('[c:Weil] es regnet, weil es kalt ist.');
  });

  it('marks the answer when the connector is not in the sentence', () => {
    expect(marked('Ich bleibe, denn es regnet.', 'weil', ['regnet'], 'denn')).toBe('Ich bleibe, [c:denn] es [v:regnet].');
  });

  it('never marks one place twice', () => {
    expect(marked('Er ist müde, weil er krank ist.', 'weil', ['ist', 'ist', 'ist'])).toBe('Er [v:ist] müde, [c:weil] er krank [v:ist].');
    expect(marked('Er bleibt, weil er muss.', 'weil', ['weil'])).toBe('Er bleibt, [c:weil] er muss.');
  });

  it('copes with letters and characters special in a pattern', () => {
    expect(marked('Wir gehen (zu Fuß), obwohl es weit ist.', '(zu Fuß)')).toBe('Wir gehen [c:(zu Fuß)], obwohl es weit ist.');
    expect(marked('Öl, über Öl.', 'über', ['Öl'])).toBe('Öl, [c:über] [v:Öl].');
  });
});

describe('endingSegments', () => {
  it('marks endings, in order, and a word with no ending as a whole', () => {
    expect(endingSegments('Ich sehe den roten Hund.', ['d|en', 'rot|en'])).toEqual([
      { text: 'Ich sehe d' },
      { text: 'en', kind: 'e' },
      { text: ' rot' },
      { text: 'en', kind: 'e' },
      { text: ' Hund.' },
    ]);
    expect(endingSegments('Das ist ein roter Hund.', ['ein|', 'rot|er'])).toEqual([
      { text: 'Das ist ' },
      { text: 'ein', kind: 'c' },
      { text: ' rot' },
      { text: 'er', kind: 'e' },
      { text: ' Hund.' },
    ]);
  });
});
