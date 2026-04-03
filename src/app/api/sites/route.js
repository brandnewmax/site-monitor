export const dynamic = 'force-dynamic'

import { getSites, saveSites } from '@/lib/kv'

// GET: list all sites
export async function GET() {
  try {
    const sites = await getSites()
    return Response.json({ sites })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// POST: add a site
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
    return Response.json({ site: newSite })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// DELETE: remove a site by url
export async function DELETE(req) {
  try {
    const { url } = await req.json()
    const sites = await getSites()
    const next = sites.filter(s => s.url !== url)
    await saveSites(next)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
