import { db } from '../db/schema';
import { nextProgress } from './practice';
import type { GrammarProgress } from './types';

export async function loadProgress(): Promise<Map<string, GrammarProgress>> {
  const rows = await db.grammar.toArray();
  return new Map(rows.map((p) => [p.id, p]));
}

/** Call only for an exercise's first answer in a session. */
export async function recordGrammar(id: string, ok: boolean, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.grammar, async () => {
    await db.grammar.put(nextProgress(await db.grammar.get(id), id, ok, now));
  });
}
