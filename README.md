# 网站监控工具

服务端持续监控网站可用性，无需保持页面开启。通过 Railway Cron 定时检测，结果存储在 Upstash Redis。

## 部署步骤

### 1. 创建 Upstash Redis 数据库
1. 前往 [upstash.com](https://upstash.com) → Create Database → Redis
2. 复制以下两个值（注意 URL 必须是 https:// 开头）：
   - `KV_REST_API_URL` → 这是 `UPSTASH_REDIS_REST_URL`
   - `KV_REST_API_TOKEN` → 这是 `UPSTASH_REDIS_REST_TOKEN`

### 2. 上传代码到 GitHub
Fork 或直接上传本项目到你的 GitHub 仓库。

### 3. 在 Railway 部署
1. 登录 [railway.app](https://railway.app)
2. New Project → Deploy from GitHub Repo → 选择本仓库
3. 在 Variables 里添加以下环境变量：

```
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXxxxxxxxxxxxxxxxx
CRON_SECRET=任意一段随机字符串（用于保护 Cron 接口）
```

4. 部署完成后，记录你的 Railway 域名，如 `https://your-app.railway.app`

### 4. 设置 Railway Cron
1. 在 Railway 项目里点 **+ New** → **Cron Job**
2. Schedule 填写（例如每 30 分钟）：`*/30 * * * *`
3. Command 填写：
```
curl -s -H "Authorization: Bearer 你的CRON_SECRET" https://your-app.railway.app/api/cron
```

### 5. 打开页面配置
访问你的 Railway 域名 → 点「设置」→ 填写：
- API Base URL
- 登录码（API Key）
- 模型
- 企业微信 Webhook（选填）

## Cron 时间表参考

| 间隔 | Schedule |
|------|----------|
| 15 分钟 | `*/15 * * * *` |
| 30 分钟 | `*/30 * * * *` |
| 1 小时 | `0 * * * *` |
| 2 小时 | `0 */2 * * *` |
| 6 小时 | `0 */6 * * *` |

## 技术栈
- Next.js 14 + Railway
- Upstash Redis（存储网站列表、配置、检测历史）
- Railway Cron（定时触发检测，服务端运行，无需开页面）
