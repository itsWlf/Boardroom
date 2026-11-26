// Icon picker search. Pure.
/**
 * Icon names matching a query, best first. Every word of the query must be found in the icon's name or its search
 * words ("open folder", "trash", "floppy"); names that contain the whole query come before matches on search
 * words only. An empty query returns every name in its given order.
 */
export function searchIcons(names: string[], words: Record<string, string>, query: string): string[] {
  const parts = query
    .trim()
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean);
  if (!parts.length) return names;
  const joined = parts.join('');
  const ranked: [string, number][] = [];
  for (const n of names) {
    const name = n.toLowerCase(),
      extra = words[n] ?? '';
    const rank = name === joined ? 0 : name.startsWith(joined) ? 1 : name.includes(joined) ? 2 : 3;
    if (rank < 3 || parts.every(p => name.includes(p) || extra.includes(p))) ranked.push([n, rank]);
  }
  // A stable sort keeps the given order inside each rank.
  return ranked.sort((a, b) => a[1] - b[1]).map(r => r[0]);
}
