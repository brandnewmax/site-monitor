export const dynamic = 'force-dynamic'

import { getSites, saveSites, getConfig } from '@/lib/kv'
import { checkSiteUrl, sendWechatAlert } from '@/lib/checker'

// Cron runs every 5 minutes (*/5 * * * *)
// Each call checks ALL sites that are "due" in this 5-minute window
//
// Per-site interval = 1800s / total sites
// Sites due = those whose slot falls within [now-300s, now]

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

  const CYCLE_SECONDS = 1800
  const CRON_WINDOW = 300 // cron fires every 5 min = 300s
  const perSiteSeconds = Math.max(10, Math.floor(CYCLE_SECONDS / sites.length))
  const nowSeconds = Math.floor(Date.now() / 1000)

  // Find all site indices whose time slot falls in this cron window
  const currentSlot = Math.floor(nowSeconds / perSiteSeconds)
  const windowSlots = Math.max(1, Math.floor(CRON_WINDOW / perSiteSeconds))

  // Collect unique site indices due in this window
  const dueIndices = new Set()
  for (let i = 0; i < windowSlots; i++) {
    dueIndices.add((currentSlot - i) % sites.length)
  }
  // Always include at least the current slot
  dueIndices.add(currentSlot % sites.length)

  const dueList = [...dueIndices]
  const results = []

  // Check each due site serially
  for (const idx of dueList) {
    const site = sites[idx]
    if (!site) continue

    try {
      const result = await checkSiteUrl(site.url, config)
      const entry = { time: Date.now(), code: result.status_code, ok: result.ok, note: result.note }
      sites[idx].history = [entry, ...(site.history || [])].slice(0, 10)
      sites[idx].status = result.ok ? 'ok' : 'err'
      sites[idx].code = result.status_code
      sites[idx].note = result.note
      sites[idx].lastCheck = Date.now()

      if (!result.ok && config.webhookUrl) {
        await sendWechatAlert(config.webhookUrl, site.url, result.status_code, result.note)
      }

      results.push({ url: site.url, ok: result.ok, code: result.status_code })
    } catch (err) {
      results.push({ url: site.url, ok: false, error: err.message })
    }

    // Small gap between sites to avoid rate limiting
    if (dueList.indexOf(idx) < dueList.length - 1) {
      await new Promise(r => setTimeout(r, 1500))
    }
  }

  await saveSites(sites)

  return Response.json({
    message: '检测完成',
    checked: results.length,
    per_site_interval_seconds: perSiteSeconds,
    total_sites: sites.length,
    results,
    time: new Date().toISOString(),
  })
}
