export const dynamic = 'force-dynamic'

import { getSites, saveSites, getConfig } from '@/lib/kv'
import { checkSiteUrl, sendWechatAlert } from '@/lib/checker'

// Railway Cron calls this endpoint on schedule
// Protected by a secret token to prevent unauthorized calls
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

  const results = []

  for (const site of sites) {
    try {
      const result = await checkSiteUrl(site.url, config)
      const entry = {
        time: Date.now(),
        code: result.status_code,
        ok: result.ok,
        note: result.note,
      }
      site.history = [entry, ...(site.history || [])].slice(0, 10)
      site.status = result.ok ? 'ok' : 'err'
      site.code = result.status_code
      site.note = result.note
      site.lastCheck = Date.now()

      if (!result.ok && config.webhookUrl) {
        await sendWechatAlert(config.webhookUrl, site.url, result.status_code, result.note)
      }

      results.push({ url: site.url, ok: result.ok, code: result.status_code })
    } catch (err) {
      results.push({ url: site.url, ok: false, error: err.message })
    }

    // Small delay between sites to avoid rate limiting
    if (sites.indexOf(site) < sites.length - 1) {
      await new Promise(r => setTimeout(r, 1500))
    }
  }

  await saveSites(sites)

  return Response.json({
    message: '检测完成',
    checked: results.length,
    results,
    time: new Date().toISOString(),
  })
}
