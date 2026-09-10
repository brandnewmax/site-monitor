// D1 数据访问层，替代原来的 Upstash Redis 整块 JSON 读写

const HISTORY_KEEP = 10

// --- kv：配置项（webhookUrl / intervalMin）与轮转游标 ---

export async function getConfig(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM kv').all()
  const config = {}
  for (const row of results) {
    try { config[row.key] = JSON.parse(row.value) } catch { config[row.key] = row.value }
  }
  return config
}

export async function setConfig(env, patch) {
  const stmts = Object.entries(patch)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => env.DB
      .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind(k, JSON.stringify(v)))
  if (stmts.length) await env.DB.batch(stmts)
}

const kvStmt = (env, key, value) => env.DB
  .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  .bind(key, JSON.stringify(value))

// 轮转状态：cursor 是上次检测到的 rowid，acc 是速率累积的小数余额
export async function getTickState(env) {
  const { results } = await env.DB
    .prepare("SELECT key, value FROM kv WHERE key IN ('cursor', 'acc')").all()

  const state = { cursor: 0, acc: 0 }
  for (const row of results) {
    try {
      const n = JSON.parse(row.value)
      if (Number.isFinite(n)) state[row.key] = n
    } catch {}
  }
  return state
}

export async function saveTickState(env, { cursor, acc }) {
  await env.DB.batch([kvStmt(env, 'cursor', cursor), kvStmt(env, 'acc', acc)])
}

// --- sites ---

export async function countSites(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM sites').first()
  return row?.n || 0
}

export async function getSiteUrls(env) {
  const { results } = await env.DB.prepare('SELECT url FROM sites ORDER BY rowid').all()
  return results.map(r => r.url)
}

// 轮转：取游标之后的 N 个站点，不足则从头补。返回的 cursor 供下一轮使用
export async function nextBatch(env, cursor, n) {
  const { results: tail } = await env.DB
    .prepare('SELECT rowid AS id, url FROM sites WHERE rowid > ? ORDER BY rowid LIMIT ?')
    .bind(cursor, n).all()

  let batch = tail
  if (batch.length < n) {
    const { results: head } = await env.DB
      .prepare('SELECT rowid AS id, url FROM sites WHERE rowid <= ? ORDER BY rowid LIMIT ?')
      .bind(cursor, n - batch.length).all()
    batch = batch.concat(head)
  }

  return { batch, nextCursor: batch.length ? batch[batch.length - 1].id : cursor }
}

// --- 写入一次检测结果：更新站点状态 + 追加历史 + 裁剪旧历史 ---

export async function recordResult(env, url, entry) {
  const okFlag = entry.ok ? 1 : 0
  await env.DB.batch([
    env.DB
      .prepare('UPDATE sites SET status = ?, code = ?, note = ?, last_check = ? WHERE url = ?')
      .bind(entry.ok ? 'ok' : 'err', entry.code, entry.note, entry.time, url),
    env.DB
      .prepare('INSERT INTO history (url, time, code, ok, note) VALUES (?, ?, ?, ?, ?)')
      .bind(url, entry.time, entry.code, okFlag, entry.note),
    // 删除第 10 新那条及更早的记录
    env.DB
      .prepare(`DELETE FROM history WHERE url = ?1 AND rowid <= (
        SELECT rowid FROM history WHERE url = ?1 ORDER BY time DESC LIMIT 1 OFFSET ?2
      )`)
      .bind(url, HISTORY_KEEP - 1),
  ])
}

export async function addSite(env, url) {
  await env.DB
    .prepare('INSERT INTO sites (url, status, code, note, last_check) VALUES (?, ?, NULL, ?, NULL)')
    .bind(url, 'pending', '').run()
}

export async function removeSite(env, url) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sites WHERE url = ?').bind(url),
    env.DB.prepare('DELETE FROM history WHERE url = ?').bind(url),
  ])
}

export async function hasSite(env, url) {
  const row = await env.DB.prepare('SELECT 1 AS x FROM sites WHERE url = ?').bind(url).first()
  return !!row
}

// 站点列表 + 每站最近 10 条历史。逐站索引查询后批量提交，避免全表扫描历史表
export async function getSitesWithHistory(env) {
  const { results: sites } = await env.DB
    .prepare('SELECT url, status, code, note, last_check FROM sites ORDER BY rowid').all()

  if (sites.length === 0) return []

  const historyStmts = sites.map(s => env.DB
    .prepare('SELECT time, code, ok, note FROM history WHERE url = ? ORDER BY time DESC LIMIT ?')
    .bind(s.url, HISTORY_KEEP))

  const batches = await env.DB.batch(historyStmts)

  return sites.map((s, i) => ({
    url: s.url,
    status: s.status,
    code: s.code,
    note: s.note,
    lastCheck: s.last_check,
    history: (batches[i]?.results || []).map(h => ({
      time: h.time,
      code: h.code,
      ok: !!h.ok,
      note: h.note,
    })),
  }))
}
