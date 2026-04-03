export const dynamic = 'force-dynamic'

import { getSites, saveSites, getConfig } from '@/lib/kv'
import { checkSiteUrl, sendWechatAlert } from '@/lib/checker'

// Manual check triggered from the frontend for a single site
export async function POST(req) {
  try {
    const { url } = await req.json()
    if (!url) return Response.json({ error: '缺少 url 参数' }, { status: 400 })

    const config = await getConfig()
    if (!config.apiKey || !config.baseUrl || !config.model) {
      return Response.json({ error: '请先在设置中填写 API 配置' }, { status: 400 })
    }

    const result = await checkSiteUrl(url, config)

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

    if (!result.ok && config.webhookUrl) {
      sendWechatAlert(config.webhookUrl, url, result.status_code, result.note).catch(() => {})
    }

    return Response.json({ ...result, checked_at: Date.now() })
  } catch (err) {
    return Response.json({ error: err.message || '服务器内部错误' }, { status: 500 })
  }
}
