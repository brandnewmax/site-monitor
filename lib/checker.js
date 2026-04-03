// Pure server-side fetch checker — no AI, faster and more reliable

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
]

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

function describeStatus(code, cfProtected) {
  if (code === 0) return '连接超时或无法访问'
  if (code >= 200 && code < 300) return '页面正常访问'
  if (code === 301) return '301 永久重定向'
  if (code === 302) return '302 临时重定向'
  if (code === 403 && cfProtected) return '403 Cloudflare 防护拦截（网站本身可能正常）'
  if (code === 403) return '403 访问被拒绝'
  if (code === 404) return '404 页面不存在'
  if (code === 429) return '429 请求过于频繁'
  if (code === 500) return '500 服务器内部错误'
  if (code === 502) return '502 网关错误'
  if (code === 503) return '503 服务暂时不可用'
  if (code === 504) return '504 网关超时'
  if (code >= 300 && code < 400) return `${code} 重定向`
  if (code >= 400 && code < 500) return `${code} 客户端错误`
  if (code >= 500) return `${code} 服务器错误`
  return `HTTP ${code}`
}

function isCloudflareResponse(headers, body) {
  const server = headers.get('server') || ''
  const cfRay = headers.get('cf-ray') || ''
  return server.toLowerCase().includes('cloudflare') || cfRay !== ''
}

// Single fetch attempt
async function attemptFetch(url, timeoutMs = 15000) {
  const abort = new AbortController()
  const timeoutId = setTimeout(() => abort.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': randomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
      signal: abort.signal,
    })
    clearTimeout(timeoutId)

    const code = res.status
    const cfProtected = isCloudflareResponse(res.headers, '')

    // Cloudflare special handling:
    // 403 from Cloudflare = site is up but blocking our IP, treat as WARNING not ERROR
    // 503 from Cloudflare = site may be truly down
    let ok = code >= 200 && code < 300
    let warning = false

    if (cfProtected && code === 403) {
      ok = true   // site is reachable, CF just blocked us
      warning = true
    }

    return {
      ok,
      warning,
      status_code: code,
      note: describeStatus(code, cfProtected),
      cf_protected: cfProtected,
    }
  } catch (err) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') {
      return { ok: false, warning: false, status_code: 0, note: '连接超时（15秒内无响应）', cf_protected: false }
    }
    // DNS failure, connection refused, etc.
    const msg = err.message || ''
    let note = '连接失败'
    if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) note = 'DNS 解析失败，域名可能已失效'
    else if (msg.includes('ECONNREFUSED')) note = '连接被拒绝'
    else if (msg.includes('ECONNRESET')) note = '连接被重置'
    else if (msg.includes('certificate') || msg.includes('SSL')) note = 'SSL 证书错误'
    else note = `连接失败：${msg.slice(0, 50)}`
    return { ok: false, warning: false, status_code: 0, note, cf_protected: false }
  }
}

// Main export: fetch with retry on failure
export async function checkSiteUrl(url, config, maxRetries = 2) {
  let lastResult = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await attemptFetch(url)

    // If ok or warning (CF block), return immediately
    if (result.ok || result.warning) return result

    lastResult = result

    // On failure, wait before retry with a different UA
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, 3000))
    }
  }

  return lastResult
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
