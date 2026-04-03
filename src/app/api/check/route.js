export const dynamic = 'force-dynamic'

export async function POST(req) {
  try {
    const { url, apiKey, baseUrl, model } = await req.json()

    if (!url || !apiKey || !baseUrl || !model) {
      return Response.json({ error: '缺少必要参数（url / apiKey / baseUrl / model）' }, { status: 400 })
    }

    if (!apiKey) {
      return Response.json({ error: '请先在【设置】中填写登录码（API Key）' }, { status: 400 })
    }

    const prompt = `You are an HTTP status checker. Make a real HTTP GET request to this URL: ${url}

Return ONLY a valid JSON object, no markdown, no explanation, no backticks:
{"status_code": <number>, "ok": <boolean>, "note": "<brief note in Chinese>"}

Rules:
- ok = true ONLY if status_code is 200-299
- 3xx redirects: report redirect status code, ok = false
- If unreachable/timeout: status_code = 0, ok = false
- note: brief description like "正常访问", "301 重定向", "连接超时", "404 页面不存在"`

    // Abort after 45 seconds to prevent hanging
    const abort = new AbortController()
    const timeoutId = setTimeout(() => abort.abort(), 45000)

    let aiRes
    try {
      aiRes = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: abort.signal,
      })
    } catch (fetchErr) {
      clearTimeout(timeoutId)
      if (fetchErr.name === 'AbortError') {
        return Response.json(
          { error: `连接超时：无法在 45 秒内连接到 ${baseUrl}，请检查 API 地址` },
          { status: 500 }
        )
      }
      return Response.json(
        { error: `无法连接到 API (${baseUrl})：${fetchErr.message}` },
        { status: 500 }
      )
    } finally {
      clearTimeout(timeoutId)
    }

    if (!aiRes.ok) {
      const errText = await aiRes.text()
      let detail = errText.slice(0, 200)
      // Try to extract message from JSON error body
      try {
        const errJson = JSON.parse(errText)
        detail = errJson?.error?.message || errJson?.message || detail
      } catch {}
      return Response.json(
        { error: `API 错误 ${aiRes.status}：${detail}` },
        { status: 500 }
      )
    }

    // skill: never assume response is JSON — read text first
    const rawText = await aiRes.text()
    let aiData
    try {
      aiData = JSON.parse(rawText)
    } catch {
      return Response.json(
        { error: `API 返回了非 JSON 内容：${rawText.slice(0, 150)}` },
        { status: 500 }
      )
    }

    const content = aiData.choices?.[0]?.message?.content || ''
    const clean = content.replace(/```json|```/g, '').trim()

    let parsed
    try {
      parsed = JSON.parse(clean)
    } catch {
      return Response.json(
        { error: `AI 返回格式异常，无法解析：${clean.slice(0, 100)}` },
        { status: 500 }
      )
    }

    return Response.json({
      status_code: parsed.status_code ?? 0,
      ok: parsed.ok ?? false,
      note: parsed.note ?? '',
      checked_at: Date.now(),
    })
  } catch (err) {
    return Response.json(
      { error: err.message || '服务器内部错误' },
      { status: 500 }
    )
  }
}
