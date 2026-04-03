export const dynamic = 'force-dynamic'

import { getSites, saveSites } from '@/lib/kv'
import { cacheGet, cacheSet, cacheDelete } from '@/lib/cache'

const CACHE_KEY = 'sites'
const CACHE_TTL = 60 // 1 minute — cron writes invalidate anyway

// GET: list all sites (cached)
export async function GET() {
  try {
    const cached = cacheGet(CACHE_KEY)
    if (cached) return Response.json({ sites: cached, cached: true })

    const sites = await getSites()
    cacheSet(CACHE_KEY, sites, CACHE_TTL)
    return Response.json({ sites })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// POST: add a site — invalidates cache
export async function POST(req) {
  try {
    const { url } = await req.json()
    if (!url || !url.startsWith('http')) {
      return Response.json({ error: '无效的 URL' }, { status: 400 })
    }
    const sites = await getSites()
    if (sites.find(s => s.url === url)) {
      return Response.json({ error: '该网站已存在' }, { status: 409 })
    }
    const newSite = { url, status: 'pending', code: null, note: '', lastCheck: null, history: [] }
    sites.push(newSite)
    await saveSites(sites)
    cacheDelete(CACHE_KEY)
    return Response.json({ site: newSite })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// DELETE: remove a site — invalidates cache
export async function DELETE(req) {
  try {
    const { url } = await req.json()
    const sites = await getSites()
    const next = sites.filter(s => s.url !== url)
    await saveSites(next)
    cacheDelete(CACHE_KEY)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
