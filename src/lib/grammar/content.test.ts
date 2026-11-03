// Checks the authored topics; each test lists every problem it finds, not just the first.
import { describe, expect, it } from 'vitest';
import { allExercises, areaById, areaOf, ENDING_TOPICS, GRAMMAR_AREAS, GRAMMAR_STAGES, GRAMMAR_TOPICS, ORDER_TOPICS, RELATIVE_TOPICS, stageById, stageNumber, topicById } from './content';
import { CASES, DETERMINERS, endingOptions, expectedEnding, RELATIVE_PRONOUNS, relativePronoun } from './endings';
import { stageExercises, stageSession } from './path';
import { checkBuild, shuffledTiles, tilesOf } from './practice';
import type { BuildExercise, EndingExercise, PickExercise, RuleText, Tr } from './types';

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
  it('has the seven topics, reachable by id', () => {
    expect(GRAMMAR_TOPICS.map((t) => t.id).sort()).toEqual(['adj-der', 'adj-ein', 'adj-none', 'relative', 'verb-after', 'verb-end', 'verb-second']);
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

  it('every exercise practises a connector or pattern of its topic', () => {
    const bad = GRAMMAR_TOPICS.flatMap((t) => {
      const words = new Set(t.area === 'order' ? t.connectors.map((c) => c.word) : t.patterns.map((p) => p.id));
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
      ...(t.area === 'order'
        ? t.connectors.flatMap((c) => missing(`${t.id} connector ${c.word}`, c.meaning))
        : t.patterns.flatMap((p) => missing(`${t.id} example of ${p.id}`, p.example?.tr))),
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
      ...(t.area === 'order'
        ? t.connectors.flatMap((c) => (c.note ? missing(`${t.id} note of ${c.word}`, c.note) : []))
        : t.patterns.flatMap((p) => [...missing(`${t.id} rule of ${p.id}`, p.rule), ...(p.note ? missing(`${t.id} note of ${p.id}`, p.note) : [])])),
    ]);
    expect(bad).toEqual([]);
    for (const t of GRAMMAR_TOPICS) expect(t.points.length, t.id).toBeGreaterThan(0);
  });

  it('every example shows its connector and verbs', () => {
    const bad = ORDER_TOPICS.flatMap((t) =>
      t.examples.flatMap((x) =>
        [x.connector, ...x.verbs].filter((w) => !filled(w) || !hasWord(x.de, w)).map((w) => `"${x.de}" lacks "${w}"`),
      ),
    );
    expect(bad).toEqual([]);
  });

  it('each connector has at least 5 build and 2 pick exercises', () => {
    const bad = ORDER_TOPICS.flatMap((t) =>
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
    const bad = ORDER_TOPICS.flatMap((t) =>
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
    const bad = ORDER_TOPICS.flatMap((t) =>
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
  /** What stages may hold: every connector and every ending pattern. */
  const keys = () => GRAMMAR_TOPICS.flatMap((t) => (t.area === 'order' ? t.connectors.map((c) => c.word) : t.patterns.map((p) => p.id)));
  const keysOf = (id: string) => {
    const t = topicById(id);
    return t ? (t.area === 'order' ? t.connectors.map((c) => c.word) : t.patterns.map((p) => p.id)) : [];
  };
  const orderStages = () => GRAMMAR_STAGES.filter((s) => topicById(s.topic)?.area === 'order');
  const stagePicks = (words: string[]) => allOf().filter((e) => e.kind === 'pick' && words.includes(e.connector)).length;

  it('are numbered 1 to 17, in order, and reachable by id', () => {
    expect(GRAMMAR_STAGES.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    for (const s of GRAMMAR_STAGES) expect(stageById(s.id)).toBe(s);
    expect(stageById(18)).toBeUndefined();
  });

  it('hold only connectors and patterns of the topics', () => {
    const known = new Set(keys());
    expect(GRAMMAR_STAGES.flatMap((s) => s.words.filter((w) => !known.has(w)).map((w) => `${s.id}: ${w}`))).toEqual([]);
    for (const s of GRAMMAR_STAGES) expect(s.words.length, `stage ${s.id}`).toBeGreaterThan(0);
  });

  it('hold each of the 19 connectors and 16 patterns exactly once', () => {
    expect(new Set(keys()).size).toBe(35);
    expect(GRAMMAR_STAGES.flatMap((s) => s.words).sort()).toEqual(keys().slice().sort());
  });

  it('belong to one topic, and every topic’s stages follow each other', () => {
    const bad = GRAMMAR_STAGES.flatMap((s) => {
      const own = new Set(keysOf(s.topic));
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

  it('have at least 2 picks, their own or their partners’ (word order)', () => {
    const bad = orderStages().filter((s) => stagePicks([...s.words, ...s.partners]) < 2).map((s) => s.id);
    expect(bad).toEqual([]);
  });

  it('open with a full session that shows some picks (word order)', () => {
    const bad = orderStages().flatMap((s) => {
      const list = stageSession(s, allOf(), new Map(), 0, () => 0.5);
      const nPick = list.filter((e) => e.kind === 'pick').length;
      return stageExercises(s, allOf()).length && list.length && nPick >= 2 ? [] : [`${s.id}: ${list.length} exercises, ${nPick} picks`];
    });
    expect(bad).toEqual([]);
  });
});

describe('ending content', () => {
  const endings = () => allOf().filter((e): e is EndingExercise => e.kind === 'ending');
  const gapsIn = (text: string) => [...text.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));

  it('every ending topic has its four cases, in order, with the right ids', () => {
    const bad = ENDING_TOPICS.flatMap((t) => {
      const ids = t.patterns.map((p) => p.id).join(' ');
      const want = CASES.map((c) => `${t.declension}-${c}`).join(' ');
      const cases = t.patterns.map((p) => p.case).join(' ');
      return [...(ids === want ? [] : [`${t.id}: ${ids}`]), ...(cases === CASES.join(' ') ? [] : [`${t.id} cases: ${cases}`])];
    });
    expect(bad).toEqual([]);
    for (const t of ENDING_TOPICS) expect(t.id, t.declension).toBe(`adj-${t.declension}`);
  });

  it('exercise ids are adj-<pattern>-<n> and the pattern matches the phrase', () => {
    const bad = endings().flatMap((e) => {
      const problems: string[] = [];
      if (!new RegExp(`^adj-${e.connector}-\\d+$`).test(e.id)) problems.push(`${e.id}: id doesn't match ${e.connector}`);
      const decl = e.phrase.det === '' ? 'none' : DETERMINERS[e.phrase.det]?.declension;
      if (`${decl}-${e.phrase.case}` !== e.connector) problems.push(`${e.id}: phrase is ${decl}-${e.phrase.case}`);
      return problems;
    });
    expect(bad).toEqual([]);
  });

  it('ending exercises are only in ending topics, and ending topics hold only them', () => {
    const bad = GRAMMAR_TOPICS.flatMap((t) =>
      t.exercises.filter((e) => (e.kind === 'ending') !== (t.area === 'endings')).map((e) => `${t.id}/${e.id}: ${e.kind}`),
    );
    expect(bad).toEqual([]);
  });

  it('every gap stands once in the text, in order, and the text ends like a sentence', () => {
    const bad = endings().flatMap((e) => {
      const want = e.gaps.map((_, i) => i).join(',');
      const got = gapsIn(e.text).join(',');
      return [
        ...(e.gaps.length ? [] : [`${e.id}: no gaps`]),
        ...(got === want ? [] : [`${e.id}: gaps {${got}} for ${e.gaps.length}`]),
        ...(/\S[.!?]$/.test(e.text.trim()) ? [] : [`${e.id}: "${e.text}"`]),
      ];
    });
    expect(bad).toEqual([]);
  });

  it('every answer is the ending the rules give', () => {
    const bad = endings().flatMap((e) =>
      e.gaps.flatMap((g, i) => {
        const want = expectedEnding(g, e.phrase);
        if (want === undefined) return [`${e.id}: no such phrase ${JSON.stringify(e.phrase)}`];
        return g.answer === want ? [] : [`${e.id} gap ${i} (${g.stem}): "${g.answer}", the rules give "${want}"`];
      }),
    );
    expect(bad).toEqual([]);
  });

  it('determiner gaps belong to the phrase’s determiner, and each answer is among its options', () => {
    const bad = endings().flatMap((e) =>
      e.gaps.flatMap((g, i) => {
        const problems: string[] = [];
        if (g.role === 'det' && e.phrase.det === '') problems.push(`${e.id} gap ${i}: a determiner gap with no determiner`);
        if (!endingOptions(g, e.phrase.det).includes(g.answer)) problems.push(`${e.id} gap ${i}: "${g.answer}" not offered`);
        if (!filled(g.stem)) problems.push(`${e.id} gap ${i}: no stem`);
        return problems;
      }),
    );
    expect(bad).toEqual([]);
  });

  it('every pattern has at least 6 exercises, both levels', () => {
    const bad = ENDING_TOPICS.flatMap((t) =>
      t.patterns.flatMap((p) => {
        const own = t.exercises.filter((e) => e.connector === p.id);
        const levels = new Set(own.map((e) => e.level));
        return own.length >= 6 && levels.size === 2 ? [] : [`${p.id}: ${own.length} exercises, levels ${[...levels].join(',')}`];
      }),
    );
    expect(bad).toEqual([]);
  });

  it('every example and pattern example marks words that stand in it', () => {
    const marked = (where: string, x: { de: string; marks: string[] }) =>
      x.marks.length
        ? x.marks.filter((m) => !m.includes('|') || !hasWord(x.de, m.replace('|', ''))).map((m) => `${where}: "${x.de}" lacks "${m}"`)
        : [`${where}: no marks`];
    const bad = ENDING_TOPICS.flatMap((t) => [
      ...t.examples.flatMap((x) => marked(t.id, x)),
      ...t.patterns.flatMap((p) => (p.example ? marked(p.id, p.example) : [`${p.id}: no example`])),
    ]);
    expect(bad).toEqual([]);
  });
});

describe('relative content', () => {
  const own = () => RELATIVE_TOPICS.flatMap((t) => t.exercises);
  const pronouns = new Set(Object.values(RELATIVE_PRONOUNS).flatMap((row) => Object.values(row)));
  const lower = (s: string) => s.toLocaleLowerCase('de');

  it('the relative topic has its four cases, in order, with the right ids', () => {
    for (const t of RELATIVE_TOPICS) {
      expect(t.patterns.map((p) => p.id)).toEqual(CASES.map((c) => `rel-${c}`));
      expect(t.patterns.map((p) => p.case)).toEqual(CASES);
    }
  });

  it('relative exercises are only in the relative topic, and it holds only them', () => {
    const bad = GRAMMAR_TOPICS.flatMap((t) =>
      t.exercises.filter((e) => (e.relative !== undefined) !== (t.area === 'relative')).map((e) => `${t.id}/${e.id}`),
    );
    expect(bad).toEqual([]);
  });

  it('exercise ids are <pattern>-<n>, and the pattern is the case of the pronoun', () => {
    const bad = own().flatMap((e) => {
      const problems: string[] = [];
      if (!new RegExp(`^${e.connector}-\\d+$`).test(e.id)) problems.push(`${e.id}: id doesn't match ${e.connector}`);
      if (e.kind !== 'ending' && `rel-${e.relative?.case}` !== e.connector) problems.push(`${e.id}: case ${e.relative?.case} in ${e.connector}`);
      return problems;
    });
    expect(bad).toEqual([]);
  });

  it('every pick answer is the pronoun the table gives, among pronouns only', () => {
    const bad = own()
      .filter((e): e is PickExercise => e.kind === 'pick')
      .flatMap((e) => {
        const r = e.relative!;
        const want = relativePronoun(r.case, r.gender);
        return [
          ...(e.answer === want ? [] : [`${e.id}: "${e.answer}", the table gives "${want}" (${r.case} ${r.gender})`]),
          ...e.options.filter((o) => !pronouns.has(o)).map((o) => `${e.id}: option "${o}" is no relative pronoun`),
          ...(hasWord(e.before, r.noun) ? [] : [`${e.id}: "${r.noun}" isn't before the blank`]),
          ...(/,\s*(\p{L}+\s*)?$/u.test(e.before) ? [] : [`${e.id}: the blank doesn't follow a comma or a preposition after one`]),
        ];
      });
    expect(bad).toEqual([]);
  });

  it('every build starts its clause with the pronoun the table gives, after the noun', () => {
    const bad = own()
      .filter((e): e is BuildExercise => e.kind === 'build')
      .flatMap((e) => {
        const r = e.relative!;
        const want = relativePronoun(r.case, r.gender);
        return [
          ...(e.given && hasWord(e.given, r.noun) ? [] : [`${e.id}: "${r.noun}" isn't in the given part`]),
          ...e.answers
            .filter((a) => !new RegExp(`^(\\p{L}+ )?${want}(?!\\p{L})`, 'u').test(lower(a)))
            .map((a) => `${e.id}: "${a}" doesn't start with ${want} (${r.case} ${r.gender})`),
        ];
      });
    expect(bad).toEqual([]);
  });

  it('every pattern has at least 8 picks and 3 builds, both levels', () => {
    const bad = RELATIVE_TOPICS.flatMap((t) =>
      t.patterns.flatMap((p) => {
        const list = t.exercises.filter((e) => e.connector === p.id);
        const nPick = list.filter((e) => e.kind === 'pick').length;
        const nBuild = list.filter((e) => e.kind === 'build').length;
        const levels = new Set(list.map((e) => e.level));
        return nPick >= 8 && nBuild >= 3 && levels.size === 2 ? [] : [`${p.id}: ${nPick} picks, ${nBuild} builds, levels ${[...levels].join(',')}`];
      }),
    );
    expect(bad).toEqual([]);
  });

  it('every example shows its noun, then its pronoun, and its verbs', () => {
    const bad = RELATIVE_TOPICS.flatMap((t) =>
      [...t.examples, ...t.patterns.map((p) => p.example)].flatMap((x) => {
        const at = x.de.indexOf(x.noun);
        return [
          ...(at >= 0 && hasWord(x.de.slice(at + x.noun.length), x.pronoun) ? [] : [`"${x.de}": no "${x.pronoun}" after "${x.noun}"`]),
          ...(pronouns.has(x.pronoun) ? [] : [`"${x.de}": "${x.pronoun}" is no relative pronoun`]),
          ...(x.verbs.length ? [] : [`"${x.de}": no verbs`]),
          ...x.verbs.filter((w) => !hasWord(x.de, w)).map((w) => `"${x.de}" lacks "${w}"`),
        ];
      }),
    );
    expect(bad).toEqual([]);
  });
});

describe('grammar areas', () => {
  it('hold every topic and stage once, stages numbered from 1 in each', () => {
    expect(GRAMMAR_AREAS.flatMap((a) => a.topics.map((t) => t.id)).sort()).toEqual(GRAMMAR_TOPICS.map((t) => t.id).sort());
    expect(GRAMMAR_AREAS.flatMap((a) => a.stages.map((s) => s.id)).sort((x, y) => x - y)).toEqual(GRAMMAR_STAGES.map((s) => s.id));
    for (const a of GRAMMAR_AREAS) {
      expect(a.stages.map((s) => stageNumber({ ...s })), a.id).toEqual(a.stages.map((_, i) => i + 1));
      expect(areaById(a.id)).toBe(a);
      for (const t of a.topics) expect(areaOf(t.id)).toBe(a);
    }
  });
});
