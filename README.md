# 网站监控工具

实时监控网站可用性，通过 AI API 检测 HTTP 状态码，自动定时轮询。

## 功能

- 添加/移除监控网站
- 通过 AI API 真实检测 HTTP 状态码（区分 200/301/4xx/5xx）
- 可选检测间隔：15分钟 / 30分钟 / 1小时 / 2小时 / 3小时 / 6小时
- 每个网站最近 10 次历史记录（彩色圆点）
- 悬停圆点查看详细时间和状态码
- 设置持久化（localStorage）

## 本地运行

```bash
npm install
npm run dev
```

访问 http://localhost:3000

## 部署到 Railway

1. Fork 或 clone 本仓库到你的 GitHub
2. 登录 [railway.app](https://railway.app)
3. New Project → Deploy from GitHub Repo → 选择本仓库
4. 无需任何环境变量，直接部署
5. 部署完成后访问分配的域名

## 使用说明

1. 打开网站后点右上角「⚙ 设置」
2. 填写：
   - API Base URL（如 `https://ai.liaobots.work/v1`）
   - 登录码（你的 API Key）
   - 模型（如 `gpt-4o`）
3. 保存后回到主页，输入要监控的网址添加
4. 系统立即检测一次，之后按选定间隔自动检测

## 技术栈

- Next.js 14
- 后端 API 路由中转请求（避免浏览器 CORS 限制）
- 无数据库（数据存储在浏览器 localStorage）
