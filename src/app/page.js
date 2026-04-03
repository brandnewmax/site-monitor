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
    // skill: filter corrupt records on load — missing url or malformed history
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

export default function Home() {
  const [sites, setSites] = useState([])
  const [intervalMin, setIntervalMin] = useState(30)
  const [urlInput, setUrlInput] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://ai.liaobots.work/v1')
  const [model, setModel] = useState('gpt-4o')
  const [showSettings, setShowSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [nextCheckIn, setNextCheckIn] = useState(null)
  const [isInitialized, setIsInitialized] = useState(false)

  const sitesRef = useRef(sites)
  const apiKeyRef = useRef(apiKey)
  const baseUrlRef = useRef(baseUrl)
  const modelRef = useRef(model)
  const intervalRef = useRef(intervalMin)
  const timerRef = useRef(null)
  const countdownRef = useRef(null)
  const nextCheckAtRef = useRef(null)

  useEffect(() => { sitesRef.current = sites }, [sites])
  useEffect(() => { apiKeyRef.current = apiKey }, [apiKey])
  useEffect(() => { baseUrlRef.current = baseUrl }, [baseUrl])
  useEffect(() => { modelRef.current = model }, [model])
  useEffect(() => { intervalRef.current = intervalMin }, [intervalMin])

  useEffect(() => {
    const saved = loadStorage()
    if (saved) {
      if (saved.sites) setSites(saved.sites)
      if (saved.intervalMin) setIntervalMin(saved.intervalMin)
      if (saved.apiKey) setApiKey(saved.apiKey)
      if (saved.baseUrl) setBaseUrl(saved.baseUrl)
      if (saved.model) setModel(saved.model)
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

    // skill: watchdog — abort if no response in 60 seconds
    const abortCtrl = new AbortController()
    const watchdog = setTimeout(() => abortCtrl.abort(), 60000)

    try {
      const res = await fetch('/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: site.url, apiKey: key, baseUrl: base, model: mdl }),
        signal: abortCtrl.signal,
      })

      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { data = { error: `服务器返回异常：${text.slice(0, 100)}` } }

      setSites(prev => {
        const next = [...prev]
        if (!next[index]) return prev
        const entry = {
          time: Date.now(),
          code: data.error ? 'ERR' : data.status_code,
          ok: data.ok ?? false,
          note: data.error ?? data.note ?? '',
        }
        const history = [entry, ...(next[index].history || [])].slice(0, 10)
        next[index] = {
          ...next[index],
          status: data.error ? 'err' : (data.ok ? 'ok' : 'err'),
          code: data.error ? 'ERR' : data.status_code,
          note: data.error ?? data.note ?? '',
          lastCheck: Date.now(),
          history,
        }
        persistState(next, null)
        return next
      })
    } catch (err) {
      const note = err.name === 'AbortError'
        ? '检测超时：60 秒内未收到响应，请重试'
        : err.message
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

    timerRef.current = setTimeout(async () => {
      await checkAll()
      scheduleNext()
    }, ms)

    countdownRef.current = setInterval(() => {
      const diff = Math.max(0, nextCheckAtRef.current - Date.now())
      const m = Math.floor(diff / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setNextCheckIn(`${m}分${s < 10 ? '0' : ''}${s}秒后`)
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
    if (sites.find(s => s.url === url)) return alert('已存在该网站')
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
    setTimeout(() => setSettingsSaved(false), 2000)
    setShowSettings(false)
  }

  function handleIntervalChange(val) {
    setIntervalMin(val)
    persistState(null, val)
  }

  const totalOk = sites.filter(s => s.status === 'ok').length
  const totalErr = sites.filter(s => s.status === 'err').length

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>网站监控</h1>
            <p style={styles.subtitle}>
              {sites.length > 0
                ? `${totalOk} 正常 · ${totalErr} 异常 · 共 ${sites.length} 个站点`
                : '添加网站开始监控'}
            </p>
          </div>
          <button style={styles.settingsBtn} onClick={() => setShowSettings(true)}>
            ⚙ 设置
          </button>
        </div>

        {showSettings && (
          <div style={styles.modal} onClick={() => setShowSettings(false)}>
            <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
              <h2 style={styles.modalTitle}>API 配置</h2>
              <label style={styles.label}>API Base URL</label>
              <input
                style={styles.input}
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://ai.liaobots.work/v1"
              />
              <label style={styles.label}>登录码 (API Key)</label>
              <input
                style={styles.input}
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="你的登录码"
              />
              <label style={styles.label}>模型</label>
              <input
                style={styles.input}
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="gpt-4o"
              />
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button style={styles.btnPrimary} onClick={saveSettings}>
                  {settingsSaved ? '已保存 ✓' : '保存'}
                </button>
                <button style={styles.btnSecondary} onClick={() => setShowSettings(false)}>
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={styles.card}>
          <div style={styles.addRow}>
            <input
              style={{ ...styles.input, flex: 1, marginBottom: 0 }}
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addSite()}
              placeholder="输入网站地址，如 https://example.com"
            />
            <button style={styles.btnPrimary} onClick={addSite}>添加</button>
          </div>
          <div style={styles.intervalRow}>
            <span style={styles.label2}>检测间隔：</span>
            <select
              style={styles.select}
              value={intervalMin}
              onChange={e => handleIntervalChange(Number(e.target.value))}
            >
              {INTERVAL_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {sites.length > 0 && nextCheckIn && (
              <span style={styles.nextCheck}>下次检测 {nextCheckIn}</span>
            )}
            {sites.length > 0 && (
              <button style={styles.btnSm} onClick={() => { checkAll(); scheduleNext() }}>
                立即检测全部
              </button>
            )}
          </div>
        </div>

        {!apiKey && (
          <div style={styles.warning}>
            ⚠ 请先点右上角「设置」填写 API 配置，否则无法检测
          </div>
        )}

        <div style={styles.card}>
          {sites.length === 0 ? (
            <div style={styles.empty}>还没有添加任何网站</div>
          ) : (
            sites.map((site, i) => (
              <SiteRow key={site.url} site={site} onCheck={() => checkSite(i)} onRemove={() => removeSite(i)} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function SiteRow({ site, onCheck, onRemove }) {
  const statusColor = site.status === 'ok' ? '#3B6D11' : site.status === 'err' ? '#A32D2D' : '#888'
  const badgeBg = site.status === 'ok' ? '#EAF3DE' : site.status === 'err' ? '#FCEBEB' : site.status === 'checking' ? '#E6F1FB' : '#f0f0f0'
  const badgeText = site.status === 'ok'
    ? `${site.code} 正常`
    : site.status === 'err'
    ? (site.code ? `${site.code} 异常` : '异常')
    : site.status === 'checking' ? '检测中...' : '待检测'

  return (
    <div style={styles.siteRow}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={styles.siteUrl}>{site.url}</div>
        <div style={styles.siteMeta}>
          <span style={{ ...styles.badge, background: badgeBg, color: statusColor }}>
            {badgeText}
          </span>
          {site.note && <span style={styles.noteText}>{site.note}</span>}
          {site.lastCheck && (
            <span style={styles.timeText}>
              {new Date(site.lastCheck).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <div style={styles.historyDots}>
          {site.history && site.history.length > 0
            ? site.history.map((h, j) => (
                <span
                  key={j}
                  title={`${new Date(h.time).toLocaleString()} · ${h.code} · ${h.note}`}
                  style={{
                    ...styles.dot,
                    background: h.ok ? '#639922' : '#E24B4A',
                  }}
                />
              ))
            : <span style={styles.noHistory}>暂无历史</span>
          }
        </div>
      </div>
      <div style={styles.siteActions}>
        <button style={styles.btnSm} onClick={onCheck}>检测</button>
        <button style={{ ...styles.btnSm, color: '#A32D2D' }} onClick={onRemove}>移除</button>
      </div>
    </div>
  )
}

const styles = {
  page: { minHeight: '100vh', padding: '24px 16px', background: 'var(--bg, #f5f5f5)' },
  container: { maxWidth: 760, margin: '0 auto' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 },
  title: { fontSize: 24, fontWeight: 600, marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#666' },
  settingsBtn: { background: 'white', border: '1px solid #ddd', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 14 },
  card: { background: 'white', borderRadius: 12, border: '1px solid #e5e5e5', padding: '16px 20px', marginBottom: 12 },
  addRow: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 },
  intervalRow: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  label: { display: 'block', fontSize: 13, color: '#555', marginBottom: 6, marginTop: 12 },
  label2: { fontSize: 13, color: '#555' },
  input: { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, marginBottom: 4, outline: 'none' },
  select: { padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, cursor: 'pointer' },
  btnPrimary: { padding: '9px 18px', background: '#111', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, whiteSpace: 'nowrap' },
  btnSecondary: { padding: '9px 18px', background: 'white', color: '#333', border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer', fontSize: 14 },
  btnSm: { padding: '5px 12px', background: 'white', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: '#444' },
  siteRow: { display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderBottom: '1px solid #f0f0f0' },
  siteUrl: { fontSize: 14, fontWeight: 500, wordBreak: 'break-all', marginBottom: 5 },
  siteMeta: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 },
  badge: { fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 500 },
  noteText: { fontSize: 11, color: '#888' },
  timeText: { fontSize: 11, color: '#aaa' },
  historyDots: { display: 'flex', gap: 4, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: '50%', display: 'inline-block', cursor: 'default' },
  noHistory: { fontSize: 11, color: '#bbb' },
  siteActions: { display: 'flex', gap: 6, flexShrink: 0, paddingTop: 2 },
  empty: { textAlign: 'center', padding: '2rem', color: '#aaa', fontSize: 14 },
  nextCheck: { fontSize: 12, color: '#aaa' },
  warning: { background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#795548' },
  modal: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modalBox: { background: 'white', borderRadius: 14, padding: 24, width: '100%', maxWidth: 420, margin: 16 },
  modalTitle: { fontSize: 18, fontWeight: 600, marginBottom: 4 },
}
