import { liveQuery } from 'dexie';
import { trackLoad } from './pageLoad';

/**
 * Reactive IndexedDB query for components: re-runs whenever the tables it reads change.
 *
 *   const sets = live(() => db.sets.toArray());
 *   {#each sets.value ?? [] as s} …
 *
 * Must be called during component initialisation. Route components are re-mounted on
 * navigation, so route params read inside `query` can be treated as constants.
 */
export function live<T>(query: () => T | Promise<T>): { readonly value: T | undefined } {
  let value = $state<T | undefined>(undefined);
  // The page transition waits for the first result (see pageLoad.ts).
  const loaded = trackLoad();
  $effect(() => {
    const sub = liveQuery(query).subscribe({
      next: (v) => {
        value = v;
        loaded();
      },
      error: (e) => {
        console.error(e);
        loaded();
      },
    });
    return () => {
      sub.unsubscribe();
      loaded();
    };
  });
  return {
    get value() {
      return value;
    },
  };
}
