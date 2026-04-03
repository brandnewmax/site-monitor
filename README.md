# 网站监控工具

服务端持续监控网站可用性，无需保持页面开启。通过 Railway Cron 每分钟触发，智能轮询每个网站，结果存储在 Upstash Redis。

## 检测机制

Cron **每分钟**执行一次，每次只检测**一个**网站（按时间槽轮流），完全无并发。

```
每个网站的检测间隔 = 设定总间隔 ÷ 网站数量

例：30 分钟间隔，10 个网站 → 每个网站每 3 分钟检测一次
例：30 分钟间隔，100 个网站 → 每个网站每 18 秒检测一次
```

间隔在页面上调整，Cron 的 Schedule 始终是 `* * * * *`（每分钟），不需要改。

## 部署步骤

### 1. 创建 Upstash Redis 数据库
1. 前往 [upstash.com](https://upstash.com) → Create Database → Redis
2. 复制（URL 必须是 https:// 开头）：
   - `KV_REST_API_URL` → 填入 `UPSTASH_REDIS_REST_URL`
   - `KV_REST_API_TOKEN` → 填入 `UPSTASH_REDIS_REST_TOKEN`

### 2. 上传代码到 GitHub 并在 Railway 部署
在 Railway Variables 里添加：
```
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXxxxxxxxxxxxxxxxx
CRON_SECRET=任意一段随机字符串
```

### 3. 设置 Railway Cron Job
- **Schedule**：`* * * * *`（每分钟，固定不变）
- **Command**：
```
curl -s -H "Authorization: Bearer 你的CRON_SECRET" https://你的railway域名/api/cron
```

### 4. 打开页面完成配置
访问 Railway 域名 → 点「设置」→ 填写 API Base URL、登录码、模型、企业微信 Webhook。
