export function createLiveResource(loader, { ttlMs = 30_000, now = () => Date.now() } = {}) {
  const entries = new Map();

  const valid = (entry) => entry && entry.value !== undefined && now() - entry.loadedAt < ttlMs;

  async function get(key, { force = false } = {}) {
    const entry = entries.get(key);
    if (!force && valid(entry)) return entry.value;
    if (!force && entry?.pending) return entry.pending;

    const pending = Promise.resolve()
      .then(() => loader(key))
      .then((value) => {
        entries.set(key, { value, loadedAt: now(), pending: null });
        return value;
      })
      .catch((error) => {
        if (entries.get(key)?.pending === pending) entries.delete(key);
        throw error;
      });
    entries.set(key, { value: entry?.value, loadedAt: entry?.loadedAt || 0, pending });
    return pending;
  }

  return {
    get,
    peek: (key) => valid(entries.get(key)) ? entries.get(key).value : null,
    invalidate: (key) => key === undefined ? entries.clear() : entries.delete(key),
    clear: () => entries.clear(),
  };
}
