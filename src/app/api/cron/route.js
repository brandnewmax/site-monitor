export const dynamic = 'force-dynamic'

import { getSites, saveSites, getConfig } from '@/lib/kv'
import { checkSiteUrl, sendWechatAlert } from '@/lib/checker'
import { cacheDelete } from '@/lib/cache'

const CONCURRENCY = 2

async function runWithConcurrency(tasks, limit) {
  const results = []
  const executing = new Set()

  for (const task of tasks) {
    const p = task().then(r => { executing.delete(p); return r })
    executing.add(p)
    results.push(p)
    if (executing.size >= limit) await Promise.race(executing)
  }

  return Promise.all(results)
}

export async function GET(req) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Read from Redis directly (cron is the source of truth writer)
  const [config, sites] = await Promise.all([getConfig(), getSites()])

  if (sites.length === 0) {
    return Response.json({ message: '没有监控网站', checked: 0 })
  }

  const tasks = sites.map((site, idx) => async () => {
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

      return { url: site.url, ok: result.ok, code: result.status_code, note: result.note }
    } catch (err) {
      return { url: site.url, ok: false, error: err.message }
    }
  })

  const results = await runWithConcurrency(tasks, CONCURRENCY)

  await saveSites(sites)
  cacheDelete('sites') // invalidate so next frontend fetch gets fresh data

  return Response.json({
    message: '检测完成',
    checked: results.length,
    ok: results.filter(r => r.ok).length,
    err: results.filter(r => !r.ok).length,
    total_sites: sites.length,
    results,
    time: new Date().toISOString(),
  })
}
