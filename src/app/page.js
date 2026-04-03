'use client'

import { useState, useEffect, useCallback } from 'react'

function getDomain(url) {
  try { return new URL(url).hostname } catch { return url }
}

function formatTime(ts) {
  if (!ts) return null
  const diffMin = Math.floor((Date.now() - ts) / 60000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)} 小时前`
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function normalizeUrl(raw) {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  return trimmed.startsWith('http') ? trimmed : 'https://' + trimmed
}

export default function Home() {
  const [sites, setSites] = useState([])
  const [config, setConfig] = useState({ webhookUrl: '' })
  const [urlInput, setUrlInput] = useState('')
  const [inputFocused, setInputFocused] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [checkingUrls, setCheckingUrls] = useState(new Set())
  const [formWebhook, setFormWebhook] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState('all') // 'all' | 'ok' | 'err'

  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch('/api/sites')
      const data = await res.json()
      if (data.sites) setSites(data.sites)
    } catch {}
  }, [])

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config')
      const data = await res.json()
      setConfig(data)
      setFormWebhook(data.webhookUrl || '')
    } catch {}
  }, [])

  useEffect(() => {
    Promise.all([fetchSites(), fetchConfig()]).finally(() => setLoading(false))
    const poll = setInterval(fetchSites, 30000)
    return () => clearInterval(poll)
  }, [fetchSites, fetchConfig])

  // Derived: does this URL already exist?
  const normalizedInput = normalizeUrl(urlInput)
  const alreadyExists = normalizedInput !== '' && sites.some(s => s.url === normalizedInput)
  const canAdd = normalizedInput !== '' && !alreadyExists

  async function addSite() {
    if (!canAdd) return
    const url = normalizedInput
    setUrlInput('')
    try {
      const res = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (res.ok) {
        await fetchSites()
        checkOneSite(url)
      }
    } catch {}
  }

  async function removeSite(url) {
    try {
      await fetch('/api/sites', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      setSites(prev => prev.filter(s => s.url !== url))
    } catch {}
  }

  async function checkOneSite(url) {
    setCheckingUrls(prev => new Set([...prev, url]))
    try {
      const res = await fetch('/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      setSites(prev => prev.map(s => {
        if (s.url !== url) return s
        const entry = { time: Date.now(), code: data.status_code, ok: data.ok, note: data.note }
        return {
          ...s,
          status: data.error ? 'err' : (data.ok ? 'ok' : 'err'),
          code: data.error ? 'ERR' : data.status_code,
          note: data.error ?? data.note ?? '',
          lastCheck: Date.now(),
          history: [entry, ...(s.history || [])].slice(0, 10),
        }
      }))
    } catch {}
    setCheckingUrls(prev => { const n = new Set(prev); n.delete(url); return n })
  }

  async function checkAllSites() {
    for (const site of sites) {
      await checkOneSite(site.url)
      await new Promise(r => setTimeout(r, 800))
    }
  }

  async function saveSettings() {
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: formWebhook }),
      })
      setSettingsSaved(true)
      await fetchConfig()
      setTimeout(() => { setSettingsSaved(false); setShowSettings(false) }, 1000)
    } catch {}
  }

  const totalOk = sites.filter(s => s.status === 'ok').length
  const totalErr = sites.filter(s => s.status === 'err').length

  // Filter + search
  const visibleSites = sites.filter(s => {
    const matchFilter = filter === 'all' || (filter === 'ok' && s.status === 'ok') || (filter === 'err' && s.status === 'err')
    const q = searchQuery.trim().toLowerCase()
    const matchSearch = !q || s.url.toLowerCase().includes(q) || getDomain(s.url).toLowerCase().includes(q)
    return matchFilter && matchSearch
  })

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ width: 20, height: 20, border: '2px solid var(--border-strong)', borderTopColor: 'var(--text-primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 80 }}>

      {/* Header */}
      <header style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 20px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="4" cy="4" r="2.5" fill="white" opacity="0.9"/>
                <circle cx="10" cy="4" r="2.5" fill="white" opacity="0.6"/>
                <circle cx="4" cy="10" r="2.5" fill="white" opacity="0.6"/>
                <circle cx="10" cy="10" r="2.5" fill="white" opacity="0.3"/>
              </svg>
            </div>
            <span style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-0.01em' }}>网站监控</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'var(--ok-bg)', border: '1px solid var(--border)', borderRadius: 20 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ok-dot)', animation: 'pulse-ring 3s infinite' }} />
              <span style={{ fontSize: 11, color: 'var(--ok)', fontWeight: 500 }}>服务端自动监控中</span>
            </div>
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

        {/* Stats — clickable filter */}
        {sites.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {[
              { key: 'ok',  label: '正常', value: totalOk,      color: 'var(--ok)',             bg: 'var(--ok-bg)' },
              { key: 'err', label: '异常', value: totalErr,     color: 'var(--err)',            bg: 'var(--err-bg)' },
              { key: 'all', label: '总计', value: sites.length, color: 'var(--text-secondary)', bg: 'var(--surface)' },
            ].map(s => (
              <div
                key={s.key}
                onClick={() => setFilter(f => f === s.key ? 'all' : s.key)}
                style={{
                  flex: 1, background: s.bg, border: `1px solid ${filter === s.key ? s.color : 'var(--border)'}`,
                  borderRadius: 'var(--radius-md)', padding: '10px 14px', cursor: 'pointer',
                  transition: 'all 0.15s', outline: filter === s.key ? `2px solid ${s.color}` : 'none', outlineOffset: 1,
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = s.color}
                onMouseLeave={e => e.currentTarget.style.borderColor = filter === s.key ? s.color : 'var(--border)'}
              >
                <div style={{ fontSize: 22, fontWeight: 500, color: s.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{s.value}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {s.label}
                  {filter === s.key && s.key !== 'all' && <span style={{ fontSize: 9, background: s.color, color: 'white', borderRadius: 3, padding: '1px 4px' }}>筛选中</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add input */}
        <div style={{ background: inputFocused ? 'var(--surface)' : 'var(--accent)', border: inputFocused ? '1px solid var(--border-strong)' : '1px solid transparent', borderRadius: 'var(--radius-lg)', boxShadow: inputFocused ? 'var(--shadow-md)' : 'var(--shadow-sm)', transition: 'all 0.2s', marginBottom: 12, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '4px 4px 4px 16px', gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={inputFocused ? 'var(--text-muted)' : 'rgba(255,255,255,0.7)'} strokeWidth="1.6" style={{ flexShrink: 0 }}>
              <path d="M7 2v10M2 7h10" strokeLinecap="round"/>
            </svg>
            <input
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addSite()}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder="添加网站地址，如 example.com"
              style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 14, color: inputFocused ? 'var(--text-primary)' : 'white', padding: '10px 0', fontFamily: 'var(--font-sans)' }}
            />
            <button
              onClick={addSite}
              disabled={!canAdd}
              title={alreadyExists ? '该网站已存在' : ''}
              style={{
                padding: '8px 16px',
                background: alreadyExists ? 'var(--err-bg)' : inputFocused ? 'var(--accent)' : 'rgba(255,255,255,0.2)',
                color: alreadyExists ? 'var(--err)' : 'white',
                border: alreadyExists ? '1px solid var(--err)' : inputFocused ? 'none' : '1px solid rgba(255,255,255,0.3)',
                borderRadius: 'var(--radius-md)', cursor: canAdd ? 'pointer' : 'default',
                fontSize: 13, fontWeight: 500, transition: 'all 0.15s', whiteSpace: 'nowrap', fontFamily: 'var(--font-sans)',
              }}
            >
              {alreadyExists ? '已存在' : '添加'}
            </button>
          </div>
          <div style={{ borderTop: inputFocused ? '1px solid var(--border)' : '1px solid rgba(255,255,255,0.15)', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: inputFocused ? 'var(--text-muted)' : 'rgba(255,255,255,0.6)' }}>检测间隔</span>
            <span style={{ fontSize: 12, color: inputFocused ? 'var(--text-secondary)' : 'rgba(255,255,255,0.9)', background: inputFocused ? 'var(--surface-hover)' : 'rgba(255,255,255,0.15)', border: inputFocused ? '1px solid var(--border)' : '1px solid rgba(255,255,255,0.2)', borderRadius: 20, padding: '3px 10px' }}>
              每 30 分钟检测一次
            </span>
            {sites.length > 0 && (
              <button
                onClick={checkAllSites}
                style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', fontSize: 12, border: inputFocused ? '1px solid var(--border)' : '1px solid rgba(255,255,255,0.25)', borderRadius: 20, cursor: 'pointer', background: 'transparent', color: inputFocused ? 'var(--text-secondary)' : 'rgba(255,255,255,0.8)', fontFamily: 'var(--font-sans)' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = inputFocused ? 'var(--border-strong)' : 'white'; e.currentTarget.style.color = inputFocused ? 'var(--text-primary)' : 'white' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = inputFocused ? 'var(--border)' : 'rgba(255,255,255,0.25)'; e.currentTarget.style.color = inputFocused ? 'var(--text-secondary)' : 'rgba(255,255,255,0.8)' }}
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M9.5 5.5A4 4 0 1 1 8 2.2" strokeLinecap="round"/>
                  <path d="M7 1l1.5 1.5L7 4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                立即检测全部
              </button>
            )}
          </div>
        </div>

        {/* Search bar — only show when there are sites */}
        {sites.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', marginBottom: 12 }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="var(--text-muted)" strokeWidth="1.4" style={{ flexShrink: 0 }}>
              <circle cx="5.5" cy="5.5" r="4"/><path d="M9 9l2.5 2.5" strokeLinecap="round"/>
            </svg>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={`搜索 ${sites.length} 个网站...`}
              style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
            )}
          </div>
        )}

        {/* Site list */}
        {sites.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)', fontSize: 14 }}>
            <div style={{ marginBottom: 8, fontSize: 32 }}>◎</div>
            <div>输入网站地址开始监控</div>
          </div>
        ) : visibleSites.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: 14 }}>
            <div style={{ marginBottom: 6 }}>没有找到匹配的网站</div>
            <button onClick={() => { setSearchQuery(''); setFilter('all') }} style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '4px 12px', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>清除筛选</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {visibleSites.map(site => (
              <SiteRow
                key={site.url}
                site={site}
                isChecking={checkingUrls.has(site.url)}
                onCheck={() => checkOneSite(site.url)}
                onRemove={() => removeSite(site.url)}
              />
            ))}
            {(searchQuery || filter !== 'all') && (
              <div style={{ textAlign: 'center', padding: '8px', fontSize: 12, color: 'var(--text-muted)' }}>
                显示 {visibleSites.length} / {sites.length} 个网站
              </div>
            )}
          </div>
        )}
      </div>

      {/* Settings modal */}
      {showSettings && (
        <div onClick={() => setShowSettings(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20, animation: 'fadeIn 0.15s ease' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-xl)', padding: '28px 28px 24px', width: '100%', maxWidth: 440, boxShadow: 'var(--shadow-lg)', animation: 'fadeIn 0.2s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 500, letterSpacing: '-0.01em' }}>配置</h2>
              <button onClick={() => setShowSettings(false)} style={{ width: 28, height: 28, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8"/></svg>
              </button>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>企业微信机器人 Webhook（选填）</label>
              <input
                type="text"
                value={formWebhook}
                onChange={e => setFormWebhook(e.target.value)}
                placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
                style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--text-primary)', background: 'var(--bg)', outline: 'none', fontFamily: 'var(--font-sans)', transition: 'border-color 0.15s' }}
                onFocus={e => e.target.style.borderColor = 'var(--text-muted)'}
                onBlur={e => e.target.style.borderColor = 'var(--border-strong)'}
              />
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
              填写后，每次检测到异常会自动发送企业微信群通知。检测由服务端直接发起，无需 AI，更准确。
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveSettings} style={{ flex: 1, padding: 10, background: settingsSaved ? 'var(--ok-bg)' : 'var(--accent)', color: settingsSaved ? 'var(--ok)' : 'white', border: settingsSaved ? '1px solid var(--ok)' : 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 14, fontWeight: 500, transition: 'all 0.2s', fontFamily: 'var(--font-sans)' }}>
                {settingsSaved ? '已保存 ✓' : '保存'}
              </button>
              <button onClick={() => setShowSettings(false)} style={{ padding: '10px 20px', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 14, fontFamily: 'var(--font-sans)' }}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SiteRow({ site, isChecking, onCheck, onRemove }) {
  const [hovered, setHovered] = useState(false)

  const effectiveStatus = isChecking ? 'checking' : site.status
  const isOk = effectiveStatus === 'ok'
  const isErr = effectiveStatus === 'err'
  const isCheckingState = effectiveStatus === 'checking'

  const statusColor = isOk ? 'var(--ok)' : isErr ? 'var(--err)' : isCheckingState ? 'var(--checking)' : 'var(--text-muted)'
  const statusBg = isOk ? 'var(--ok-bg)' : isErr ? 'var(--err-bg)' : isCheckingState ? 'var(--checking-bg)' : 'var(--surface)'
  const codeText = isOk ? (site.code || 'OK') : isErr ? (site.code || '错误') : '—'
  const statusLabel = isOk ? '正常' : isErr ? '异常' : isCheckingState ? '检测中' : '待检测'

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ background: 'var(--surface)', border: '1px solid', borderColor: hovered ? 'var(--border-strong)' : 'var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', transition: 'all 0.15s', boxShadow: hovered ? 'var(--shadow-md)' : 'var(--shadow-sm)', animation: 'fadeIn 0.25s ease' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ marginTop: 2, width: 34, height: 34, borderRadius: 'var(--radius-sm)', background: statusBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {isCheckingState ? (
            <div style={{ width: 14, height: 14, border: '2px solid var(--checking)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          ) : (
            <span style={{ fontSize: 11, fontWeight: 600, color: statusColor, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>{codeText}</span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
            <span style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getDomain(site.url)}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{site.url}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: statusColor, fontWeight: 500 }}>{statusLabel}</span>
            {site.note && !isCheckingState && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {site.note}</span>}
            {site.lastCheck && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {formatTime(site.lastCheck)}</span>}
          </div>
          {site.history && site.history.length > 0 && (
            <div style={{ display: 'flex', gap: 3, marginTop: 8, alignItems: 'center' }}>
              {site.history.map((h, j) => (
                <div key={j} title={`${new Date(h.time).toLocaleString('zh-CN')} · ${h.code} · ${h.note}`}
                  style={{ width: 24, height: 6, borderRadius: 3, background: h.ok ? 'var(--ok-dot)' : 'var(--err-dot)', opacity: 0.3 + (j / site.history.length) * 0.7, cursor: 'default', flexShrink: 0 }} />
              ))}
              <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>最近 {site.history.length} 次</span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, opacity: hovered ? 1 : 0, transition: 'opacity 0.15s', flexShrink: 0 }}>
          <button onClick={onCheck} disabled={isCheckingState} style={{ padding: '5px 10px', fontSize: 12, border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-secondary)', cursor: isCheckingState ? 'default' : 'pointer', fontFamily: 'var(--font-sans)' }}>检测</button>
          <button onClick={onRemove} style={{ padding: '5px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--err)'; e.currentTarget.style.borderColor = 'var(--err)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)' }}
          >移除</button>
        </div>
      </div>
    </div>
  )
}
