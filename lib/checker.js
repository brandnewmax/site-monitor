// Shared site-checking logic used by both /api/check and /api/cron

export async function checkSiteUrl(url, config) {
  const { apiKey, baseUrl, model } = config

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
      return { ok: false, status_code: 0, note: `连接超时：无法在 45 秒内连接到 ${baseUrl}` }
    }
    return { ok: false, status_code: 0, note: `无法连接到 API：${fetchErr.message}` }
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
    return { ok: false, status_code: 0, note: `API 错误 ${aiRes.status}：${detail}` }
  }

  const rawText = await aiRes.text()
  let aiData
  try { aiData = JSON.parse(rawText) } catch {
    return { ok: false, status_code: 0, note: `API 返回非 JSON 内容` }
  }

  const content = aiData.choices?.[0]?.message?.content || ''
  const clean = content.replace(/```json|```/g, '').trim()

  let parsed
  try { parsed = JSON.parse(clean) } catch {
    return { ok: false, status_code: 0, note: `AI 返回格式异常` }
  }

  return {
    ok: parsed.ok ?? false,
    status_code: parsed.status_code ?? 0,
    note: parsed.note ?? '',
  }
}

export async function sendWechatAlert(webhookUrl, siteUrl, statusCode, note) {
  if (!webhookUrl) return
  const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  const codeText = statusCode === 0 ? '无法访问' : `HTTP ${statusCode}`
  const msg = {
    msgtype: 'markdown',
    markdown: {
      content: [
        '## 【慢慢来网站监控】异常告警',
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
  } catch {}
}
