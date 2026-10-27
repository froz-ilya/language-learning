<script lang="ts">
  import Icon from '../Icon.svelte';
  import { go } from '../../lib/router.svelte';
  import { articlePath } from '../../lib/reading/store';
  import { sourceInfo } from '../../lib/reading/sources';
  import type { ReadingSourceId } from '../../lib/reading/types';

  /** One article in a list: title, source badge, level, snippet; opens the reader. */
  let {
    id,
    source,
    title,
    snippet = '',
    level = '',
    meta = '',
    progress = 0,
    read = false,
  }: {
    id: string;
    source: ReadingSourceId;
    title: string;
    snippet?: string;
    level?: string;
    /** Extra muted text after the source badge ("3 words added"). */
    meta?: string;
    /** 0…1 reading progress bar (0 hides it). */
    progress?: number;
    read?: boolean;
  } = $props();
</script>

<button class="list-item article-row" onclick={() => go(articlePath(id))}>
  <span class="body">
    <span class="title" lang="de">{title}</span>
    <span class="meta">
      <span class="badge src-{source}">{sourceInfo(source).name}</span>
      {#if level}<span class="badge level">{level}</span>{/if}
      {#if read}<span class="read"><Icon name="check" size={14} /> Read</span>{/if}
      {#if meta}<span class="extra">{meta}</span>{/if}
    </span>
    {#if snippet}<span class="snippet" lang="de">{snippet}</span>{/if}
    {#if progress > 0 && !read}
      <span class="bar" aria-hidden="true"><span style:width="{Math.min(100, progress * 100)}%"></span></span>
    {/if}
  </span>
  <span class="chev"><Icon name="chevron" size={18} /></span>
</button>

<style>
  .article-row {
    align-items: flex-start;
    padding-top: 12px;
    padding-bottom: 12px;
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .title {
    font-weight: 600;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--muted);
  }
  .badge {
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
  }
  .badge.level {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
  }
  .read {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: var(--good);
    font-weight: 600;
  }
  .snippet {
    font-size: 14px;
    color: var(--muted);
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .bar {
    display: block;
    height: 4px;
    border-radius: 2px;
    background: var(--surface-2);
    overflow: hidden;
    margin-top: 2px;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
  }
  .chev {
    color: var(--muted);
    align-self: center;
    flex-shrink: 0;
  }
</style>
