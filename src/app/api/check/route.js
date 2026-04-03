export const dynamic = 'force-dynamic'

async function sendWechatAlert(webhookUrl, siteUrl, statusCode, note) {
  const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  const codeText = statusCode === 0 ? '无法访问' : `HTTP ${statusCode}`
  const msg = {
    msgtype: 'markdown',
    markdown: {
      content: [
        '## 🔴 网站异常告警',
        `**网站**：${siteUrl}`,
        `**状态**：${codeText}`,
        `**详情**：${note || '未知错误'}`,
        `**时间**：${time}`,
      ].join('\n'),
    },
  }
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    })
  } catch {
    // 通知失败不影响主流程
  }
}

export async function POST(req) {
  try {
    const { url, apiKey, baseUrl, model, webhookUrl } = await req.json()

    if (!url || !apiKey || !baseUrl || !model) {
      return Response.json({ error: '缺少必要参数（url / apiKey / baseUrl / model）' }, { status: 400 })
    }

    const prompt = `You are an HTTP status checker. Make a real HTTP GET request to this URL: ${url}

Return ONLY a valid JSON object, no markdown, no explanation, no backticks:
{"status_code": <number>, "ok": <boolean>, "note": "<brief note in Chinese>"}

Rules:
- ok = true ONLY if status_code is 200-299
- 3xx redirects: report redirect status code, ok = false
- If unreachable/timeout: status_code = 0, ok = false
- note: brief description like "正常访问", "301 重定向", "连接超时", "404 页面不存在"`

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
      try {
        const errJson = JSON.parse(errText)
        detail = errJson?.error?.message || errJson?.message || detail
      } catch {}
      return Response.json(
        { error: `API 错误 ${aiRes.status}：${detail}` },
        { status: 500 }
      )
    }

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

    const result = {
      status_code: parsed.status_code ?? 0,
      ok: parsed.ok ?? false,
      note: parsed.note ?? '',
      checked_at: Date.now(),
    }

    // 检测到异常时发送企业微信通知（不 await，不阻塞返回）
    if (!result.ok && webhookUrl) {
      sendWechatAlert(webhookUrl, url, result.status_code, result.note).catch(() => {})
    }

    return Response.json(result)
  } catch (err) {
    return Response.json(
      { error: err.message || '服务器内部错误' },
      { status: 500 }
    )
  }
}
