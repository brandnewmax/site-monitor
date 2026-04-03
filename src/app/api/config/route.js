export const dynamic = 'force-dynamic'

import { getConfig, saveConfig } from '@/lib/kv'
import { cacheGet, cacheSet, cacheDelete } from '@/lib/cache'

const CACHE_KEY = 'config'
const CACHE_TTL = 300 // 5 minutes — config rarely changes

export async function GET() {
  try {
    const cached = cacheGet(CACHE_KEY)
    if (cached) return Response.json(cached)

    const config = await getConfig()
    const result = {
      baseUrl: config.baseUrl || '',
      model: config.model || '',
      webhookUrl: config.webhookUrl || '',
      intervalMin: config.intervalMin || 30,
      hasApiKey: !!config.apiKey,
    }
    cacheSet(CACHE_KEY, result, CACHE_TTL)
    return Response.json(result)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const body = await req.json()
    const current = await getConfig()
    const next = {
      ...current,
      baseUrl: body.baseUrl ?? current.baseUrl,
      model: body.model ?? current.model,
      webhookUrl: body.webhookUrl ?? current.webhookUrl,
      intervalMin: body.intervalMin ?? current.intervalMin,
    }
    if (body.apiKey) next.apiKey = body.apiKey
    await saveConfig(next)
    cacheDelete(CACHE_KEY)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
