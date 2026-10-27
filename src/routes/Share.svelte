<script lang="ts">
  import { onMount } from 'svelte';
  import Header from '../components/Header.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { replace, route } from '../lib/router.svelte';
  import { db } from '../lib/db/schema';
  import { addSet } from '../lib/db/repo';
  import { lastQuickAddSet } from '../lib/share';

  /**
   * "Share to Deutsch" landing (#/share?term=…, set up by main.ts): picks the set the shared
   * word goes to and replaces itself with the quick-add editor, which looks the word up.
   * Target set: the last one used for quick add, else "My words" (created when missing).
   */
  const DEFAULT_SET = 'My words';
  const term = (route.query.get('term') ?? '').trim();

  async function targetSet(): Promise<number> {
    const last = lastQuickAddSet();
    if (last && (await db.sets.get(last))) return last;
    const mine = (await db.sets.toArray()).find((s) => !s.level && s.name.trim() === DEFAULT_SET);
    return mine?.id ?? (await addSet(DEFAULT_SET));
  }

  onMount(() => {
    if (!term) return replace('/');
    targetSet()
      .then((set) => replace(`/card/new?${new URLSearchParams({ set: String(set), term })}`))
      .catch((e) => {
        console.warn('share: no target set', e);
        replace('/');
      });
  });
</script>

<div class="page">
  <Header title="Add word" />
  <div class="card"><Skeleton lines={3} /></div>
</div>
