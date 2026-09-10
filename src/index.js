import { checkSiteUrl, sendWechatAlert } from './checker.js'
import * as db from './db.js'

// 单次 cron 最多检测多少个站点。
// 每站最多 2 次 fetch，所以最坏 2×8=16 个子请求，远低于 Workers 免费版 50/次 的上限。
const MAX_SITES_PER_TICK = 8

// 轮转一圈的目标时长（分钟），可由页面上调整
const DEFAULT_INTERVAL_MIN = 15

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const AUTH_HEADER = 'x-login-code'

// 设置了登录码才启用鉴权；未设置则一切照旧，不会因为忘了码把自己锁在门外。
// 返回 null 表示放行，否则返回该拒绝的响应。
async function checkAuth(request, env) {
  const code = (await db.getConfig(env)).loginCode
  if (!code) return null
  if (request.headers.get(AUTH_HEADER) === code) return null
  return json({ error: '未授权', needLogin: true }, 401)
}

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

// 一轮检测：按游标取 N 个站点，检测、落库、必要时告警
async function runTick(env) {
  const total = await db.countSites(env)
  if (total === 0) return { checked: 0, total: 0 }

  const config = await db.getConfig(env)
  const intervalMin = config.intervalMin || DEFAULT_INTERVAL_MIN

  // 每分钟该检测的站点数 = 站点数 ÷ 目标周期。保留小数余额累积，
  // 这样 26 站 / 15 分钟稳定在 1.73 站每分钟（约 15 分钟一轮），
  // 而不是被向上取整成 2 站每分钟、把实际周期悄悄缩到 13 分钟。
  const state = await db.getTickState(env)
  const acc = state.acc + total / intervalMin
  const n = Math.min(MAX_SITES_PER_TICK, Math.floor(acc))
  const nextAcc = n >= MAX_SITES_PER_TICK ? MAX_SITES_PER_TICK : acc - n

  if (n === 0) {
    await db.saveTickState(env, { cursor: state.cursor, acc })
    return { checked: 0, total, note: '本轮未到检测时机' }
  }

  const { batch, nextCursor } = await db.nextBatch(env, state.cursor, n)
  if (batch.length === 0) return { checked: 0, total }

  const tasks = batch.map(site => async () => {
    try {
      const result = await checkSiteUrl(site.url)
      await db.recordResult(env, site.url, {
        time: Date.now(),
        code: result.status_code,
        ok: result.ok,
        note: result.note,
      })

      if (!result.ok && config.webhookUrl) {
        await sendWechatAlert(config.webhookUrl, site.url, result.status_code, result.note)
      }

      return { url: site.url, ok: result.ok, code: result.status_code, note: result.note }
    } catch (err) {
      return { url: site.url, ok: false, error: err.message }
    }
  })

  const results = await runWithConcurrency(tasks, 2)
  await db.saveTickState(env, { cursor: nextCursor, acc: nextAcc })

  return {
    checked: results.length,
    ok: results.filter(r => r.ok).length,
    err: results.filter(r => !r.ok).length,
    total,
    results,
  }
}

// --- API 处理器 ---

async function handleSites(request, env) {
  const method = request.method

  if (method === 'GET') {
    const sites = await db.getSitesWithHistory(env)
    return json({ sites })
  }

  if (method === 'POST') {
    const { url } = await request.json()
    if (!url || !url.startsWith('http')) return json({ error: '无效的 URL' }, 400)
    if (await db.hasSite(env, url)) return json({ error: '该网站已存在' }, 409)

    await db.addSite(env, url)
    return json({ site: { url, status: 'pending', code: null, note: '', lastCheck: null, history: [] } })
  }

  if (method === 'DELETE') {
    const { url } = await request.json()
    await db.removeSite(env, url)
    return json({ ok: true })
  }

  return json({ error: 'Method Not Allowed' }, 405)
}

async function handleConfig(request, env) {
  if (request.method === 'GET') {
    const config = await db.getConfig(env)
    return json({
      webhookUrl: config.webhookUrl || '',
      intervalMin: config.intervalMin || DEFAULT_INTERVAL_MIN,
      hasLoginCode: !!config.loginCode,
    })
  }

  if (request.method === 'POST') {
    const body = await request.json()
    await db.setConfig(env, {
      webhookUrl: typeof body.webhookUrl === 'string' ? body.webhookUrl : undefined,
      intervalMin: Number.isFinite(body.intervalMin) && body.intervalMin > 0
        ? Math.floor(body.intervalMin)
        : undefined,
      // 非空字符串才更新，空字符串表示「不改」，避免误清空导致鉴权失效
      loginCode: typeof body.loginCode === 'string' && body.loginCode.trim()
        ? body.loginCode.trim()
        : undefined,
    })
    return json({ ok: true })
  }

  return json({ error: 'Method Not Allowed' }, 405)
}

// 手动检测单个站点
async function handleCheck(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405)

  const { url } = await request.json()
  if (!url) return json({ error: '缺少 url 参数' }, 400)

  const result = await checkSiteUrl(url)

  if (await db.hasSite(env, url)) {
    await db.recordResult(env, url, {
      time: Date.now(),
      code: result.status_code,
      ok: result.ok,
      note: result.note,
    })
  }

  return json({ ...result, checked_at: Date.now() })
}

// 手动触发一轮检测（用 CRON_SECRET 保护）
async function handleCron(request, env) {
  const secret = env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return json({ error: 'Unauthorized' }, 401)
  }
  const result = await runTick(env)
  return json({ message: '检测完成', ...result, time: new Date().toISOString() })
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)

    if (pathname.startsWith('/api/')) {
      try {
        // /api/cron 自带 CRON_SECRET 鉴权，不走登录码
        if (pathname === '/api/cron') return await handleCron(request, env)

        const denied = await checkAuth(request, env)
        if (denied) return denied

        if (pathname === '/api/sites') return await handleSites(request, env)
        if (pathname === '/api/config') return await handleConfig(request, env)
        if (pathname === '/api/check') return await handleCheck(request, env)
        return json({ error: 'Not Found' }, 404)
      } catch (err) {
        return json({ error: err.message || '服务器内部错误' }, 500)
      }
    }

    return env.ASSETS.fetch(request)
  },

  async scheduled(event, env, ctx) {
    await runTick(env)
  },
}
