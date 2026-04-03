// Simple in-memory cache to reduce Redis reads
// Cache is per-instance (Railway single replica), TTL in seconds

const store = new Map()

export function cacheGet(key) {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return null
  }
  return entry.value
}

export function cacheSet(key, value, ttlSeconds) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  })
}

export function cacheDelete(key) {
  store.delete(key)
}
