import { SourceError } from '../sources/chain';
import type { PageAnswer, PageQuery, WikiSource } from '../sources/providers/dewiktionary';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {}); // Awaited by the tasks; never an unhandled rejection.
  return { promise, resolve, reject };
}

/**
 * Batches the de.wiktionary pages that many words need. Tasks (one per word) run side by side
 * through `all`; when every unfinished task waits for a page, all waiting titles go out
 * together (one request per 50 titles). A word that then needs another page (the next spelling
 * variant, a lemma, a compound's head) asks for it in the next round, together with the others.
 *
 * Once a round fails (refusal, timeout, offline, cooling), every waiting and later page
 * request fails with that error: the batch goes on without Wiktionary.
 */
export class PageLoader implements WikiSource {
  private texts = new Map<string, Promise<string | null>>();
  private wanted = new Map<string, Deferred<string | null>>();
  private exists: { titles: string[]; done: Deferred<Set<string>> }[] = [];
  private running = 0;
  private waiting = 0;
  private flushing = false;
  private failure: { error: unknown } | null = null;
  /** Rounds sent (each one is one request per 50 titles). */
  rounds = 0;

  constructor(private readonly fetchPages: (q: PageQuery) => Promise<PageAnswer>) {}

  /** Run the tasks side by side, batching their page requests; settles like Promise.allSettled. */
  all<T>(tasks: (() => Promise<T>)[]): Promise<PromiseSettledResult<T>[]> {
    // Counted before any task starts, so the first task's request doesn't go out alone.
    this.running += tasks.length;
    return Promise.allSettled(
      tasks.map(async (task) => {
        try {
          return await task();
        } finally {
          this.running--;
          this.check();
        }
      }),
    );
  }

  wikitext(title: string): Promise<string | null> {
    const want = this.wanted.get(title);
    if (want) return this.wait(want.promise);
    const known = this.texts.get(title);
    if (known) return known;
    if (this.failure) return Promise.reject(this.failure.error);
    const d = deferred<string | null>();
    this.wanted.set(title, d);
    this.texts.set(title, d.promise);
    return this.wait(d.promise);
  }

  existing(titles: string[]): Promise<Set<string>> {
    if (this.failure) return Promise.reject(this.failure.error);
    const done = deferred<Set<string>>();
    this.exists.push({ titles, done });
    return this.wait(done.promise);
  }

  private wait<T>(p: Promise<T>): Promise<T> {
    this.waiting++;
    this.check();
    return p;
  }

  private check(): void {
    if (!this.flushing && this.waiting > 0 && this.waiting >= this.running) void this.flush();
  }

  private async flush(): Promise<void> {
    this.flushing = true;
    const wanted = this.wanted;
    const exists = this.exists;
    this.wanted = new Map();
    this.exists = [];
    this.waiting = 0;
    this.rounds++;
    let answer: PageAnswer | null = null;
    try {
      answer = await this.fetchPages({ content: [...wanted.keys()], exist: [...new Set(exists.flatMap((e) => e.titles))] });
    } catch (error) {
      this.failure = { error };
    }
    this.flushing = false;
    for (const [title, d] of wanted) {
      if (!answer) d.reject(this.failure!.error);
      else if (answer.content.has(title)) d.resolve(answer.content.get(title)!);
      else d.reject(new SourceError(`Wiktionary sent no text for "${title}"`, { refusal: false }));
    }
    for (const { titles, done } of exists) {
      if (answer) done.resolve(new Set(titles.filter((t) => answer.existing.has(t))));
      else done.reject(this.failure!.error);
    }
  }
}
