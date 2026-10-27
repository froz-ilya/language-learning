<script lang="ts" module>
  // Simple stroke icons (24×24 viewBox).
  const PATHS = {
    back: 'M15 5l-7 7 7 7',
    chevron: 'M9 5l7 7-7 7',
    plus: 'M12 5v14M5 12h14',
    gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
    speaker: 'M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14',
    turtle: 'M11 5L6 9H2v6h4l5 4V5zM15.5 9.5a3.5 3.5 0 010 5',
    star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
    trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
    edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
    folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
    cards: 'M7 4h12a1 1 0 011 1v12M4 7h12a1 1 0 011 1v11a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z',
    play: 'M7 4l13 8-13 8z',
    check: 'M5 12l5 5 9-10',
    x: 'M6 6l12 12M18 6L6 18',
    import: 'M12 3v12M7 10l5 5 5-5M4 19h16',
    search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
    flip: 'M4 12a8 8 0 0114-5.3L20 9M20 4v5h-5M20 12a8 8 0 01-14 5.3L4 15M4 20v-5h5',
    flame: 'M12 22c4 0 7-2.7 7-6.6 0-3.3-2.2-5.6-3.6-7.1-.3 1.8-1.2 3-2.4 3.4.3-3.3-1-6.4-4-8.7.2 3-1.4 5.1-2.9 6.9C4.9 11.4 5 13.3 5 15.4 5 19.3 8 22 12 22z',
    sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  } as const;
  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 22, filled = false }: { name: IconName; size?: number; filled?: boolean } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={filled ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={PATHS[name]} />
</svg>
