export const dynamic = 'force-dynamic'

import { getSites, saveSites, getConfig } from '@/lib/kv'
import { checkSiteUrl, sendWechatAlert } from '@/lib/checker'

export async function GET(req) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const config = await getConfig()
  const sites = await getSites()
  if (sites.length === 0) {
    return Response.json({ message: '没有监控网站', checked: 0 })
  }

  const CYCLE_SECONDS = 1800
  const CRON_WINDOW = 300
  const perSiteSeconds = Math.max(10, Math.floor(CYCLE_SECONDS / sites.length))
  const nowSeconds = Math.floor(Date.now() / 1000)

  const currentSlot = Math.floor(nowSeconds / perSiteSeconds)
  const windowSlots = Math.max(1, Math.floor(CRON_WINDOW / perSiteSeconds))

  const dueIndices = new Set()
  for (let i = 0; i < windowSlots; i++) {
    dueIndices.add((currentSlot - i) % sites.length)
  }
  dueIndices.add(currentSlot % sites.length)

  const dueList = [...dueIndices]
  const results = []

  for (const idx of dueList) {
    const site = sites[idx]
    if (!site) continue

    try {
      const result = await checkSiteUrl(site.url, {})
      const entry = { time: Date.now(), code: result.status_code, ok: result.ok, note: result.note }
      sites[idx].history = [entry, ...(site.history || [])].slice(0, 10)
      sites[idx].status = result.ok ? 'ok' : 'err'
      sites[idx].code = result.status_code
      sites[idx].note = result.note
      sites[idx].lastCheck = Date.now()

      if (!result.ok && config.webhookUrl) {
        await sendWechatAlert(config.webhookUrl, site.url, result.status_code, result.note)
      }

      results.push({ url: site.url, ok: result.ok, code: result.status_code, note: result.note })
    } catch (err) {
      results.push({ url: site.url, ok: false, error: err.message })
    }

    if (dueList.indexOf(idx) < dueList.length - 1) {
      await new Promise(r => setTimeout(r, 500))
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
