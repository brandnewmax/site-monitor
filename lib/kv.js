import { Redis } from '@upstash/redis'

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

export default kv

// Keys
const SITES_KEY = 'monitor:sites'
const CONFIG_KEY = 'monitor:config'

// --- Sites ---
export async function getSites() {
  const data = await kv.get(SITES_KEY)
  if (!data) return []
  const sites = typeof data === 'string' ? JSON.parse(data) : data
  return Array.isArray(sites) ? sites : []
}

export async function saveSites(sites) {
  await kv.set(SITES_KEY, JSON.stringify(sites))
}

// --- Config ---
export async function getConfig() {
  const data = await kv.get(CONFIG_KEY)
  if (!data) return {}
  return typeof data === 'string' ? JSON.parse(data) : data
}

export async function saveConfig(config) {
  await kv.set(CONFIG_KEY, JSON.stringify(config))
}
