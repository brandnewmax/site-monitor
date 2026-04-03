export const dynamic = 'force-dynamic'

import { getConfig, saveConfig } from '@/lib/kv'

// GET: fetch current config (mask apiKey)
export async function GET() {
  try {
    const config = await getConfig()
    return Response.json({
      baseUrl: config.baseUrl || '',
      model: config.model || '',
      webhookUrl: config.webhookUrl || '',
      intervalMin: config.intervalMin || 30,
      hasApiKey: !!config.apiKey,
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// POST: save config
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
    // Only update apiKey if a new one is provided (non-empty)
    if (body.apiKey) next.apiKey = body.apiKey
    await saveConfig(next)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
