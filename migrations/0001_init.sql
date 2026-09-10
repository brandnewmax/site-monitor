-- 站点表：rowid 作为轮转顺序，新站自然追加到末尾
CREATE TABLE sites (
  url        TEXT PRIMARY KEY,
  status     TEXT,
  code       INTEGER,
  note       TEXT,
  last_check INTEGER
);

-- 检测历史。每个站点只保留最近 10 条（由 recordResult 里的 DELETE 维护）
CREATE TABLE history (
  url  TEXT NOT NULL,
  time INTEGER NOT NULL,
  code INTEGER,
  ok   INTEGER,
  note TEXT
);

-- 这条索引同时服务「取最近 10 条」和「裁剪旧记录」两个查询
CREATE INDEX idx_history_url_time ON history(url, time DESC);

-- 配置与轮转游标
CREATE TABLE kv (
  key   TEXT PRIMARY KEY,
  value TEXT
);
