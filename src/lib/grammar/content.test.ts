// Checks the authored topics; each test lists every problem it finds, not just the first.
import { describe, expect, it } from 'vitest';
import { allExercises, GRAMMAR_STAGES, GRAMMAR_TOPICS, stageById, topicById } from './content';
import { stageExercises, stageSession } from './path';
import { checkBuild, shuffledTiles, tilesOf } from './practice';
import type { BuildExercise, RuleText, Tr } from './types';

const allOf = () => GRAMMAR_TOPICS.flatMap((t) => t.exercises);
const filled = (s: string | undefined) => typeof s === 'string' && s.trim() !== '';
const bagOf = (ex: BuildExercise, answer: string) =>
  tilesOf({ ...ex, answers: [answer] })
    .map((w) => w.toLocaleLowerCase('de'))
    .sort()
    .join(' ');
/** `word` as whole words of `text`, not part of a longer one. */
function hasWord(text: string, word: string): boolean {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'u').test(text);
}
const builds = () => allOf().filter((e): e is BuildExercise => e.kind === 'build');
const picks = () => allOf().flatMap((e) => (e.kind === 'pick' ? [e] : []));

describe('grammar content', () => {
  it('has the three topics, reachable by id', () => {
    expect(GRAMMAR_TOPICS.map((t) => t.id).sort()).toEqual(['verb-after', 'verb-end', 'verb-second']);
    for (const t of GRAMMAR_TOPICS) expect(topicById(t.id)).toBe(t);
  });

  it('allExercises is every exercise of every topic', () => {
    expect(allExercises().map((e) => e.id).sort()).toEqual(allOf().map((e) => e.id).sort());
  });

  it('exercise ids are unique', () => {
    const seen = new Set<string>();
    const dupes = allOf().filter((e) => seen.size === seen.add(e.id).size).map((e) => e.id);
    expect(dupes).toEqual([]);
  });

  it('every exercise practises a connector of its topic', () => {
    const bad = GRAMMAR_TOPICS.flatMap((t) => {
      const words = new Set(t.connectors.map((c) => c.word));
      return t.exercises.filter((e) => !words.has(e.connector)).map((e) => `${t.id}/${e.id}: ${e.connector}`);
    });
    expect(bad).toEqual([]);
  });

  it('accepted answers hold the same words', () => {
    const bad = builds().flatMap((e) =>
      e.answers.filter((a) => bagOf(e, a) !== bagOf(e, e.answers[0])).map((a) => `${e.id}: "${a}" vs "${e.answers[0]}"`),
    );
    expect(bad).toEqual([]);
  });

  it('answers are there and end like a sentence', () => {
    const empty = builds().filter((e) => !e.answers.length).map((e) => e.id);
    const bad = builds().flatMap((e) => e.answers.filter((a) => !/\S[.!?]$/.test(a.trim())).map((a) => `${e.id}: "${a}"`));
    expect([...empty, ...bad]).toEqual([]);
  });

  it('build exercises have at least 3 tiles and can be shuffled out of order', () => {
    const few = builds().filter((e) => tilesOf(e).length < 3).map((e) => e.id);
    const solved = builds().filter((e) => checkBuild(e, shuffledTiles(e))).map((e) => e.id);
    expect([...few, ...solved]).toEqual([]);
  });

  it('pick options hold the answer once, with 3 or 4 different words', () => {
    const bad = picks().flatMap((e) => {
      const problems: string[] = [];
      if (!e.options.includes(e.answer)) problems.push(`${e.id}: answer "${e.answer}" not in options`);
      if (new Set(e.options).size !== e.options.length) problems.push(`${e.id}: duplicate options`);
      if (e.options.length < 3 || e.options.length > 4) problems.push(`${e.id}: ${e.options.length} options`);
      return problems;
    });
    expect(bad).toEqual([]);
  });

  it('pick sentences have text around the blank', () => {
    expect(picks().filter((e) => !filled(e.before) && !filled(e.after)).map((e) => e.id)).toEqual([]);
  });

  it('every translation is filled in', () => {
    const missing = (where: string, tr: Tr) => (['ru', 'en'] as const).filter((l) => !filled(tr?.[l])).map((l) => `${where}: ${l}`);
    const bad = GRAMMAR_TOPICS.flatMap((t) => [
      ...t.exercises.flatMap((e) => missing(e.id, e.tr)),
      ...t.examples.flatMap((x) => missing(`${t.id} example "${x.de}"`, x.tr)),
      ...t.connectors.flatMap((c) => missing(`${t.id} connector ${c.word}`, c.meaning)),
    ]);
    expect(bad).toEqual([]);
  });

  it('every rule text is filled in', () => {
    const missing = (where: string, text: RuleText) => (['ru', 'en', 'de'] as const).filter((l) => !filled(text?.[l])).map((l) => `${where}: ${l}`);
    const bad = GRAMMAR_TOPICS.flatMap((t) => [
      ...missing(`${t.id} title`, t.title),
      ...missing(`${t.id} summary`, t.summary),
      ...missing(`${t.id} formula`, t.formula),
      ...t.points.flatMap((p, i) => missing(`${t.id} point ${i}`, p)),
      ...t.connectors.flatMap((c) => (c.note ? missing(`${t.id} note of ${c.word}`, c.note) : [])),
    ]);
    expect(bad).toEqual([]);
    for (const t of GRAMMAR_TOPICS) expect(t.points.length, t.id).toBeGreaterThan(0);
  });

  it('every example shows its connector and verbs', () => {
    const bad = GRAMMAR_TOPICS.flatMap((t) =>
      t.examples.flatMap((x) =>
        [x.connector, ...x.verbs].filter((w) => !filled(w) || !hasWord(x.de, w)).map((w) => `"${x.de}" lacks "${w}"`),
      ),
    );
    expect(bad).toEqual([]);
  });

  it('each connector has at least 5 build and 2 pick exercises', () => {
    const bad = GRAMMAR_TOPICS.flatMap((t) =>
      t.connectors.flatMap((c) => {
        const own = t.exercises.filter((e) => e.connector === c.word);
        const nBuild = own.filter((e) => e.kind === 'build').length;
        const nPick = own.length - nBuild;
        return nBuild >= 5 && nPick >= 2 ? [] : [`${t.id}/${c.word}: ${nBuild} build, ${nPick} pick`];
      }),
    );
    expect(bad).toEqual([]);
  });

  it('every connector has an example showing itself and its verbs', () => {
    const bad = GRAMMAR_TOPICS.flatMap((t) =>
      t.connectors.flatMap((c) => {
        const x = c.example;
        if (!x) return [`${t.id}/${c.word}: no example`];
        return [
          ...(filled(x.de) ? [] : [`${c.word}: no de`]),
          ...(['ru', 'en'] as const).filter((l) => !filled(x.tr?.[l])).map((l) => `${c.word}: no ${l}`),
          ...(x.verbs.length ? [] : [`${c.word}: no verbs`]),
          ...[x.connector, ...x.verbs].filter((w) => !filled(w) || !hasWord(x.de, w)).map((w) => `"${x.de}" lacks "${w}"`),
        ];
      }),
    );
    expect(bad).toEqual([]);
  });

  it('every connector says whether a sentence can start with it', () => {
    const langs = ['ru', 'en', 'de'] as const;
    const verbToken = /^\p{Lu}{3,}$/u;
    const bad = GRAMMAR_TOPICS.flatMap((t) =>
      t.connectors.flatMap((c) => {
        const where = `${t.id}/${c.word}`;
        const s = c.start;
        if (!s) return [`${where}: no start`];
        const problems = (['yes', 'rare', 'no'] as const).includes(s.use) ? [] : [`${where}: use "${s.use}"`];
        problems.push(...langs.filter((l) => !filled(s.rule?.[l])).map((l) => `${where}: no rule in ${l}`));
        if (s.use === 'no') {
          if (s.formula) problems.push(`${where}: a formula with use no`);
          if (s.example) problems.push(`${where}: an example with use no`);
          return problems;
        }
        for (const l of langs) {
          if (!filled(s.formula?.[l])) problems.push(`${where}: no formula in ${l}`);
          else if (!s.formula?.[l].split(' + ').some((slot) => verbToken.test(slot))) problems.push(`${where}: no VERB in the ${l} formula`);
        }
        const x = s.example;
        if (!x) return [...problems, `${where}: no example`];
        const lower = (text: string) => text.toLocaleLowerCase('de');
        if (lower(x.de ?? '').split(/[^\p{L}]/u)[0] !== lower(c.word)) problems.push(`${where}: "${x.de}" doesn't begin with it`);
        if (!filled(x.connector) || !hasWord(lower(x.de), lower(x.connector))) problems.push(`"${x.de}" lacks "${x.connector}"`);
        if (!x.verbs.length) problems.push(`${where}: no verbs in the example`);
        problems.push(...x.verbs.filter((w) => !filled(w) || !hasWord(x.de, w)).map((w) => `"${x.de}" lacks "${w}"`));
        problems.push(...(['ru', 'en'] as const).filter((l) => !filled(x.tr?.[l])).map((l) => `${where}: no ${l} translation of the example`));
        return problems;
      }),
    );
    expect(bad).toEqual([]);
  });
});

describe('grammar stages', () => {
  const connectors = () => GRAMMAR_TOPICS.flatMap((t) => t.connectors.map((c) => c.word));
  const stagePicks = (words: string[]) => allOf().filter((e) => e.kind === 'pick' && words.includes(e.connector)).length;

  it('are numbered 1 to 8, in order, and reachable by id', () => {
    expect(GRAMMAR_STAGES.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const s of GRAMMAR_STAGES) expect(stageById(s.id)).toBe(s);
    expect(stageById(9)).toBeUndefined();
  });

  it('hold only connectors of the topics', () => {
    const known = new Set(connectors());
    expect(GRAMMAR_STAGES.flatMap((s) => s.words.filter((w) => !known.has(w)).map((w) => `${s.id}: ${w}`))).toEqual([]);
    for (const s of GRAMMAR_STAGES) expect(s.words.length, `stage ${s.id}`).toBeGreaterThan(0);
  });

  it('hold each of the 19 connectors exactly once', () => {
    expect(new Set(connectors()).size).toBe(19);
    expect(GRAMMAR_STAGES.flatMap((s) => s.words).sort()).toEqual(connectors().slice().sort());
  });

  it('belong to one word-order group, and every group’s stages follow each other', () => {
    const bad = GRAMMAR_STAGES.flatMap((s) => {
      const own = new Set(topicById(s.topic)?.connectors.map((c) => c.word));
      return s.words.filter((w) => !own.has(w)).map((w) => `${s.id} (${s.topic}): ${w}`);
    });
    expect(bad).toEqual([]);
    const order = GRAMMAR_TOPICS.map((t) => t.id);
    expect(GRAMMAR_STAGES.map((s) => order.indexOf(s.topic))).toEqual(GRAMMAR_STAGES.map((s) => order.indexOf(s.topic)).sort());
  });

  it('take partners only from earlier stages', () => {
    const bad = GRAMMAR_STAGES.flatMap((s) => {
      const earlier = new Set(GRAMMAR_STAGES.filter((o) => o.id < s.id).flatMap((o) => o.words));
      return s.partners.filter((w) => !earlier.has(w)).map((w) => `${s.id}: ${w}`);
    });
    expect(bad).toEqual([]);
  });

  it('have the contrast in all three languages', () => {
    const bad = GRAMMAR_STAGES.flatMap((s) => (['ru', 'en', 'de'] as const).filter((l) => !filled(s.contrast?.[l])).map((l) => `${s.id}: ${l}`));
    expect(bad).toEqual([]);
  });

  it('have at least 2 picks, their own or their partners’', () => {
    const bad = GRAMMAR_STAGES.filter((s) => stagePicks([...s.words, ...s.partners]) < 2).map((s) => s.id);
    expect(bad).toEqual([]);
  });

  it('open with a full session that shows some picks', () => {
    const bad = GRAMMAR_STAGES.flatMap((s) => {
      const list = stageSession(s, allOf(), new Map(), 0, () => 0.5);
      const nPick = list.filter((e) => e.kind === 'pick').length;
      return stageExercises(s, allOf()).length && list.length && nPick >= 2 ? [] : [`${s.id}: ${list.length} exercises, ${nPick} picks`];
    });
    expect(bad).toEqual([]);
  });
});
