export const dynamic = 'force-dynamic'

import { getSites, saveSites } from '@/lib/kv'
import { checkSiteUrl } from '@/lib/checker'

export async function POST(req) {
  try {
    const { url } = await req.json()
    if (!url) return Response.json({ error: '缺少 url 参数' }, { status: 400 })

    const result = await checkSiteUrl(url, {})

    // Persist result back to Redis
    const sites = await getSites()
    const idx = sites.findIndex(s => s.url === url)
    if (idx !== -1) {
      const entry = { time: Date.now(), code: result.status_code, ok: result.ok, note: result.note }
      sites[idx].history = [entry, ...(sites[idx].history || [])].slice(0, 10)
      sites[idx].status = result.ok ? 'ok' : 'err'
      sites[idx].code = result.status_code
      sites[idx].note = result.note
      sites[idx].lastCheck = Date.now()
      await saveSites(sites)
    }

    return Response.json({ ...result, checked_at: Date.now() })
  } catch (err) {
    return Response.json({ error: err.message || '服务器内部错误' }, { status: 500 })
  }
}
