'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

const STORAGE_KEY = 'site_monitor_v3'
const INTERVAL_OPTIONS = [
  { label: '15 分钟', value: 15 },
  { label: '30 分钟', value: 30 },
  { label: '1 小时', value: 60 },
  { label: '2 小时', value: 120 },
  { label: '3 小时', value: 180 },
  { label: '6 小时', value: 360 },
]

function loadStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (data.sites) {
      data.sites = data.sites
        .filter(s => s && typeof s.url === 'string' && s.url.startsWith('http'))
        .map(s => ({
          ...s,
          history: Array.isArray(s.history) ? s.history.filter(h => h && h.time) : [],
          status: s.status || 'pending',
        }))
    }
    return data
  } catch { return null }
}

function saveStorage(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch {}
}

function getDomain(url) {
  try { return new URL(url).hostname } catch { return url }
}

function formatTime(ts) {
  if (!ts) return null
  const d = new Date(ts)
  const now = new Date()
  const diffMin = Math.floor((now - d) / 60000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)} 小时前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export default function Home() {
  const [sites, setSites] = useState([])
  const [intervalMin, setIntervalMin] = useState(30)
  const [urlInput, setUrlInput] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://ai.liaobots.work/v1')
  const [model, setModel] = useState('gpt-4o')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [nextCheckIn, setNextCheckIn] = useState(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)

  const sitesRef = useRef(sites)
  const apiKeyRef = useRef(apiKey)
  const baseUrlRef = useRef(baseUrl)
  const modelRef = useRef(model)
  const webhookUrlRef = useRef(webhookUrl)
  const intervalRef = useRef(intervalMin)
  const timerRef = useRef(null)
  const countdownRef = useRef(null)
  const nextCheckAtRef = useRef(null)

  useEffect(() => { sitesRef.current = sites }, [sites])
  useEffect(() => { apiKeyRef.current = apiKey }, [apiKey])
  useEffect(() => { baseUrlRef.current = baseUrl }, [baseUrl])
  useEffect(() => { modelRef.current = model }, [model])
  useEffect(() => { webhookUrlRef.current = webhookUrl }, [webhookUrl])
  useEffect(() => { intervalRef.current = intervalMin }, [intervalMin])

  useEffect(() => {
    const saved = loadStorage()
    if (saved) {
      if (saved.sites) setSites(saved.sites)
      if (saved.intervalMin) setIntervalMin(saved.intervalMin)
      if (saved.apiKey) setApiKey(saved.apiKey)
      if (saved.baseUrl) setBaseUrl(saved.baseUrl)
      if (saved.model) setModel(saved.model)
      if (saved.webhookUrl) setWebhookUrl(saved.webhookUrl)
    }
    setIsInitialized(true)
  }, [])

  const persistState = useCallback((newSites, newInterval) => {
    saveStorage({
      sites: newSites ?? sitesRef.current,
      intervalMin: newInterval ?? intervalRef.current,
      apiKey: apiKeyRef.current,
      baseUrl: baseUrlRef.current,
      model: modelRef.current,
      webhookUrl: webhookUrlRef.current,
    })
  }, [])

  const checkSite = useCallback(async (index, currentSites) => {
    const list = currentSites ?? sitesRef.current
    const site = list[index]
    if (!site) return
    const key = apiKeyRef.current
    const base = baseUrlRef.current
    const mdl = modelRef.current

    setSites(prev => {
      const next = [...prev]
      if (next[index]) next[index] = { ...next[index], status: 'checking' }
      return next
    })

    const abortCtrl = new AbortController()
    const watchdog = setTimeout(() => abortCtrl.abort(), 60000)

    try {
      const res = await fetch('/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: site.url, apiKey: key, baseUrl: base, model: mdl, webhookUrl: webhookUrlRef.current }),
        signal: abortCtrl.signal,
      })
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { data = { error: `服务器返回异常：${text.slice(0, 100)}` } }

      setSites(prev => {
        const next = [...prev]
        if (!next[index]) return prev
        const entry = { time: Date.now(), code: data.error ? 'ERR' : data.status_code, ok: data.ok ?? false, note: data.error ?? data.note ?? '' }
        const history = [entry, ...(next[index].history || [])].slice(0, 10)
        next[index] = { ...next[index], status: data.error ? 'err' : (data.ok ? 'ok' : 'err'), code: data.error ? 'ERR' : data.status_code, note: data.error ?? data.note ?? '', lastCheck: Date.now(), history }
        persistState(next, null)
        return next
      })
    } catch (err) {
      const note = err.name === 'AbortError' ? '检测超时：60 秒内未收到响应' : err.message
      setSites(prev => {
        const next = [...prev]
        if (!next[index]) return prev
        const entry = { time: Date.now(), code: 0, ok: false, note }
        const history = [entry, ...(next[index].history || [])].slice(0, 10)
        next[index] = { ...next[index], status: 'err', code: 0, note, lastCheck: Date.now(), history }
        persistState(next, null)
        return next
      })
    } finally {
      clearTimeout(watchdog)
    }
  }, [persistState])

  const checkAll = useCallback(async () => {
    const list = sitesRef.current
    for (let i = 0; i < list.length; i++) {
      await checkSite(i)
      if (i < list.length - 1) await new Promise(r => setTimeout(r, 1000))
    }
  }, [checkSite])

  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
    const ms = intervalRef.current * 60 * 1000
    nextCheckAtRef.current = Date.now() + ms
    timerRef.current = setTimeout(async () => { await checkAll(); scheduleNext() }, ms)
    countdownRef.current = setInterval(() => {
      const diff = Math.max(0, nextCheckAtRef.current - Date.now())
      const m = Math.floor(diff / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setNextCheckIn(`${m}:${s < 10 ? '0' : ''}${s}`)
    }, 1000)
  }, [checkAll])

  useEffect(() => {
    if (!isInitialized) return
    scheduleNext()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [isInitialized, intervalMin, scheduleNext])

  function addSite() {
    let url = urlInput.trim()
    if (!url) return
    if (!url.startsWith('http')) url = 'https://' + url
    if (sites.find(s => s.url === url)) return
    const newSite = { url, status: 'pending', code: null, note: '', lastCheck: null, history: [] }
    const next = [...sites, newSite]
    setSites(next)
    persistState(next, null)
    setUrlInput('')
    setTimeout(() => checkSite(next.length - 1, next), 100)
  }

  function removeSite(i) {
    const next = sites.filter((_, idx) => idx !== i)
    setSites(next)
    persistState(next, null)
  }

  function saveSettings() {
    persistState(null, null)
    setSettingsSaved(true)
    setTimeout(() => { setSettingsSaved(false); setShowSettings(false) }, 1000)
  }

  function handleIntervalChange(val) {
    setIntervalMin(val)
    persistState(null, val)
  }

  const totalOk = sites.filter(s => s.status === 'ok').length
  const totalErr = sites.filter(s => s.status === 'err').length
  const totalChecking = sites.filter(s => s.status === 'checking').length

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '0 0 80px' }}>

      {/* Header */}
      <header style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        position: 'sticky', top: 0, zIndex: 10,
        backdropFilter: 'blur(8px)',
      }}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 20px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="4" cy="4" r="2.5" fill="white" opacity="0.9"/>
                <circle cx="10" cy="4" r="2.5" fill="white" opacity="0.6"/>
                <circle cx="4" cy="10" r="2.5" fill="white" opacity="0.6"/>
                <circle cx="10" cy="10" r="2.5" fill="white" opacity="0.3"/>
              </svg>
            </div>
            <span style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>网站监控</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {sites.length > 0 && nextCheckIn && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
                {nextCheckIn}
              </span>
            )}
            <button
              onClick={() => setShowSettings(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'transparent', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.color = 'var(--text-primary)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)' }}
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4">
                <circle cx="6.5" cy="6.5" r="2"/>
                <path d="M6.5 1v1.5M6.5 10.5V12M12 6.5h-1.5M2.5 6.5H1M10.1 2.9l-1 1M3.9 9.1l-1 1M10.1 10.1l-1-1M3.9 3.9l-1-1"/>
              </svg>
              设置
            </button>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 20px' }}>

        {/* Stats row */}
        {sites.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, animation: 'fadeIn 0.3s ease' }}>
            {[
              { label: '正常', value: totalOk, color: 'var(--ok)', bg: 'var(--ok-bg)' },
              { label: '异常', value: totalErr, color: 'var(--err)', bg: 'var(--err-bg)' },
              { label: '总计', value: sites.length, color: 'var(--text-secondary)', bg: 'var(--surface)' },
            ].map(s => (
              <div key={s.label} style={{ flex: 1, background: s.bg, border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 14px' }}>
                <div style={{ fontSize: 22, fontWeight: 500, color: s.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{s.value}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, letterSpacing: '0.02em' }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Add URL input */}
        <div style={{
          background: 'var(--surface)',
          border: inputFocused ? '1px solid var(--border-strong)' : '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: inputFocused ? 'var(--shadow-md)' : 'var(--shadow-sm)',
          transition: 'all 0.2s ease',
          marginBottom: 12,
          overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '4px 4px 4px 16px', gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--text-muted)" strokeWidth="1.4" style={{ flexShrink: 0 }}>
              <circle cx="6" cy="6" r="4.5"/>
              <path d="M10 10l2.5 2.5" strokeLinecap="round"/>
            </svg>
            <input
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addSite()}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder="添加网站地址，如 example.com"
              style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 14, color: 'var(--text-primary)', padding: '10px 0', fontFamily: 'var(--font-sans)' }}
            />
            <button
              onClick={addSite}
              disabled={!urlInput.trim()}
              style={{
                padding: '8px 16px', background: urlInput.trim() ? 'var(--accent)' : 'var(--border)', color: urlInput.trim() ? 'white' : 'var(--text-muted)',
                border: 'none', borderRadius: 'var(--radius-md)', cursor: urlInput.trim() ? 'pointer' : 'default',
                fontSize: 13, fontWeight: 500, transition: 'all 0.15s', whiteSpace: 'nowrap',
                fontFamily: 'var(--font-sans)',
              }}
            >
              添加
            </button>
          </div>

          {/* Interval controls */}
          <div style={{ borderTop: '1px solid var(--border)', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>检测间隔</span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {INTERVAL_OPTIONS.map(o => (
                <button
                  key={o.value}
                  onClick={() => handleIntervalChange(o.value)}
                  style={{
                    padding: '3px 10px', fontSize: 12, border: '1px solid',
                    borderColor: intervalMin === o.value ? 'var(--border-strong)' : 'var(--border)',
                    borderRadius: 20, cursor: 'pointer', transition: 'all 0.15s',
                    background: intervalMin === o.value ? 'var(--accent)' : 'transparent',
                    color: intervalMin === o.value ? 'white' : 'var(--text-secondary)',
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {sites.length > 0 && (
              <button
                onClick={() => { checkAll(); scheduleNext() }}
                style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 20, cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.color = 'var(--text-primary)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M9.5 5.5A4 4 0 1 1 8 2.2" strokeLinecap="round"/>
                  <path d="M7 1l1.5 1.5L7 4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                立即检测
              </button>
            )}
          </div>
        </div>

        {/* No API key warning */}
        {!apiKey && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', marginBottom: 12, animation: 'fadeIn 0.3s ease' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#b45309" strokeWidth="1.4" style={{ flexShrink: 0 }}>
              <circle cx="7" cy="7" r="5.5"/>
              <path d="M7 4.5v3M7 9.5v.5" strokeLinecap="round"/>
            </svg>
            <span style={{ fontSize: 13, color: '#92400e' }}>请先点右上角「设置」填写 API 配置，否则无法检测</span>
            <button onClick={() => setShowSettings(true)} style={{ marginLeft: 'auto', fontSize: 12, color: '#92400e', background: 'none', border: '1px solid #d97706', borderRadius: 'var(--radius-sm)', padding: '2px 8px', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'var(--font-sans)' }}>去配置</button>
          </div>
        )}

        {/* Site list */}
        {sites.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)', fontSize: 14 }}>
            <div style={{ marginBottom: 8, fontSize: 32 }}>◎</div>
            <div>输入网站地址开始监控</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sites.map((site, i) => (
              <SiteRow
                key={site.url}
                site={site}
                onCheck={() => checkSite(i)}
                onRemove={() => removeSite(i)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Settings modal */}
      {showSettings && (
        <div
          onClick={() => setShowSettings(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20, animation: 'fadeIn 0.15s ease' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-xl)', padding: '28px 28px 24px', width: '100%', maxWidth: 440, boxShadow: 'var(--shadow-lg)', animation: 'fadeIn 0.2s ease' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>配置</h2>
              <button onClick={() => setShowSettings(false)} style={{ width: 28, height: 28, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M2 2l8 8M10 2l-8 8"/>
                </svg>
              </button>
            </div>

            {[
              { label: 'API Base URL', key: 'baseUrl', val: baseUrl, set: setBaseUrl, ph: 'https://ai.liaobots.work/v1', type: 'text' },
              { label: '登录码（API Key）', key: 'apiKey', val: apiKey, set: setApiKey, ph: '你的登录码', type: 'password' },
              { label: '模型', key: 'model', val: model, set: setModel, ph: 'gpt-4o', type: 'text' },
              { label: '企业微信 Webhook（选填）', key: 'webhookUrl', val: webhookUrl, set: setWebhookUrl, ph: 'https://qyapi.weixin.qq.com/...', type: 'text' },
            ].map(field => (
              <div key={field.key} style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.02em' }}>{field.label}</label>
                <input
                  type={field.type}
                  value={field.val}
                  onChange={e => field.set(e.target.value)}
                  placeholder={field.ph}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--text-primary)', background: 'var(--bg)', outline: 'none', fontFamily: 'var(--font-sans)', transition: 'border-color 0.15s' }}
                  onFocus={e => e.target.style.borderColor = 'var(--text-muted)'}
                  onBlur={e => e.target.style.borderColor = 'var(--border-strong)'}
                />
              </div>
            ))}

            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
              填写企业微信 Webhook 后，检测到任何异常状态将自动推送通知到群。
            </p>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={saveSettings}
                style={{ flex: 1, padding: '10px', background: settingsSaved ? 'var(--ok-bg)' : 'var(--accent)', color: settingsSaved ? 'var(--ok)' : 'white', border: settingsSaved ? '1px solid var(--ok)' : 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 14, fontWeight: 500, transition: 'all 0.2s', fontFamily: 'var(--font-sans)' }}
              >
                {settingsSaved ? '已保存 ✓' : '保存'}
              </button>
              <button
                onClick={() => setShowSettings(false)}
                style={{ padding: '10px 20px', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 14, fontFamily: 'var(--font-sans)' }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SiteRow({ site, onCheck, onRemove }) {
  const [hovered, setHovered] = useState(false)

  const isOk = site.status === 'ok'
  const isErr = site.status === 'err'
  const isChecking = site.status === 'checking'

  const statusColor = isOk ? 'var(--ok)' : isErr ? 'var(--err)' : isChecking ? 'var(--checking)' : 'var(--text-muted)'
  const statusBg = isOk ? 'var(--ok-bg)' : isErr ? 'var(--err-bg)' : isChecking ? 'var(--checking-bg)' : 'var(--surface)'
  const statusText = isOk ? (site.code ? `${site.code}` : 'OK') : isErr ? (site.code || '错误') : isChecking ? '…' : '—'
  const statusLabel = isOk ? '正常' : isErr ? '异常' : isChecking ? '检测中' : '待检测'

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '14px 16px',
        transition: 'all 0.15s ease',
        boxShadow: hovered ? 'var(--shadow-md)' : 'var(--shadow-sm)',
        borderColor: hovered ? 'var(--border-strong)' : 'var(--border)',
        animation: 'fadeIn 0.25s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {/* Status indicator */}
        <div style={{
          marginTop: 2,
          width: 34, height: 34, borderRadius: 'var(--radius-sm)',
          background: statusBg,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          animation: isErr ? 'pulse-ring 2s infinite' : 'none',
          position: 'relative',
        }}>
          {isChecking ? (
            <div style={{ width: 14, height: 14, border: '2px solid var(--checking)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          ) : (
            <span style={{ fontSize: 11, fontWeight: 600, color: statusColor, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>{statusText}</span>
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {getDomain(site.url)}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {site.url}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: statusColor, fontWeight: 500 }}>{statusLabel}</span>
            {site.note && !isChecking && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {site.note}</span>
            )}
            {site.lastCheck && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {formatTime(site.lastCheck)}</span>
            )}
          </div>

          {/* History bar */}
          {site.history && site.history.length > 0 && (
            <div style={{ display: 'flex', gap: 3, marginTop: 8, alignItems: 'center' }}>
              {site.history.map((h, j) => (
                <div
                  key={j}
                  title={`${new Date(h.time).toLocaleString('zh-CN')} · ${h.code} · ${h.note}`}
                  style={{
                    width: 24, height: 6, borderRadius: 3,
                    background: h.ok ? 'var(--ok-dot)' : 'var(--err-dot)',
                    opacity: 0.3 + (j / site.history.length) * 0.7,
                    cursor: 'default', transition: 'opacity 0.15s',
                    flexShrink: 0,
                  }}
                />
              ))}
              <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>最近 {site.history.length} 次</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 4, opacity: hovered ? 1 : 0, transition: 'opacity 0.15s', flexShrink: 0 }}>
          <button
            onClick={onCheck}
            disabled={isChecking}
            style={{ padding: '5px 10px', fontSize: 12, border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-secondary)', cursor: isChecking ? 'default' : 'pointer', fontFamily: 'var(--font-sans)' }}
          >
            检测
          </button>
          <button
            onClick={onRemove}
            style={{ padding: '5px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--err)'; e.currentTarget.style.borderColor = 'var(--err)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)' }}
          >
            移除
          </button>
        </div>
      </div>
    </div>
  )
}
