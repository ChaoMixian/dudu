/** UUIDs are unavailable in insecure contexts (plain HTTP on a LAN), so keep a fallback. */
export function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* fall through */ }
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
