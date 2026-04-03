export const dynamic = 'force-dynamic'

import { getSites, saveSites, getConfig } from '@/lib/kv'
import { checkSiteUrl, sendWechatAlert } from '@/lib/checker'

// Cron runs every 5 minutes (*/5 * * * *)
// Each call checks exactly ONE site based on current time slot
//
// Per-site interval = 1800s / total sites
// Example: 10 sites → each site checked every 180s (3 min)
//          5 sites  → each site checked every 360s (6 min)
//          1 site   → checked every 30 min (capped at 1800s)

export async function GET(req) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const config = await getConfig()
  if (!config.apiKey || !config.baseUrl || !config.model) {
    return Response.json({ error: '未配置 API，跳过检测' }, { status: 200 })
  }

  const sites = await getSites()
  if (sites.length === 0) {
    return Response.json({ message: '没有监控网站', checked: 0 })
  }

  const CYCLE_SECONDS = 1800 // fixed 30-minute cycle
  const perSiteSeconds = Math.max(10, Math.floor(CYCLE_SECONDS / sites.length))
  const nowSeconds = Math.floor(Date.now() / 1000)

  // Which site slot are we in right now?
  const slotIndex = Math.floor(nowSeconds / perSiteSeconds) % sites.length
  const site = sites[slotIndex]

  try {
    const result = await checkSiteUrl(site.url, config)
    const entry = {
      time: Date.now(),
      code: result.status_code,
      ok: result.ok,
      note: result.note,
    }
    sites[slotIndex].history = [entry, ...(site.history || [])].slice(0, 10)
    sites[slotIndex].status = result.ok ? 'ok' : 'err'
    sites[slotIndex].code = result.status_code
    sites[slotIndex].note = result.note
    sites[slotIndex].lastCheck = Date.now()

    if (!result.ok && config.webhookUrl) {
      await sendWechatAlert(config.webhookUrl, site.url, result.status_code, result.note)
    }

    await saveSites(sites)

    return Response.json({
      message: '检测完成',
      checked_index: slotIndex,
      checked_url: site.url,
      ok: result.ok,
      code: result.status_code,
      per_site_interval_seconds: perSiteSeconds,
      total_sites: sites.length,
      time: new Date().toISOString(),
    })
  } catch (err) {
    return Response.json({ error: err.message, url: site.url }, { status: 500 })
  }
}
