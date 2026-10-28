// Recent quick searches: the words opened on the search screen, newest first, kept in
// localStorage on this device only. Anything unreadable falls back to an empty list.

export const RECENT_KEY = 'search:recent';
export const MAX_RECENT = 12;
/** Longer entries are not words ("die Sehenswürdigkeit" fits easily). */
export const MAX_RECENT_LENGTH = 60;

const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

/** Keep short non-empty strings, without duplicates (case-insensitive), at most MAX_RECENT. */
export function cleanRecent(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string') continue;
    const w = norm(v);
    if (!w || w.length > MAX_RECENT_LENGTH || out.some((x) => x.toLowerCase() === w.toLowerCase())) continue;
    out.push(w);
    if (out.length >= MAX_RECENT) break;
  }
  return out;
}

export function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? cleanRecent(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function store(list: string[]): void {
  try {
    if (list.length) localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    else localStorage.removeItem(RECENT_KEY);
  } catch {
    // storage blocked or full: recent searches just aren't remembered
  }
}

/** Put a word at the top of the list (moving it if it's there already). Returns the new list. */
export function addRecent(word: string): string[] {
  const w = norm(word);
  const current = loadRecent();
  if (!w || w.length > MAX_RECENT_LENGTH) return current;
  const list = cleanRecent([w, ...current.filter((x) => x.toLowerCase() !== w.toLowerCase())]);
  store(list);
  return list;
}

export function clearRecent(): void {
  store([]);
}
