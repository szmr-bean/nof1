# Nof1-style Live Benchmark (Static)

这是一个“类 nof1.ai”风格的前端静态站点：包含 Live 曲线、Leaderboard、模型日志与持仓快照。  
默认数据为前端模拟（随机游走），便于你直接替换为自己的后端数据源。

## 目录结构

- `index.html` 入口页面
- `styles.css` 样式（暗色高对比）
- `app.js` 交互与数据模拟（可替换 `dataAdapter.fetchSnapshot()`）
- `assets/` 图标等静态资源

## 本地运行

任意静态服务器均可，例如：

```bash
# Node 方式
npx serve .
# 或 Python
python -m http.server 5173
```

然后访问 `http://localhost:5173`.

## 直接部署

### GitHub Pages
1. 新建仓库，将这些文件放到仓库根目录（或放到 `/docs` 并在 Pages 设置中选择）。
2. Settings → Pages → 选择 `main` 分支与目录。
3. 等待生成站点。

### Vercel
1. Import Git Repository
2. Framework 选 “Other”
3. Build Command 留空
4. Output Directory 留空（或 `.`）
5. Deploy

### Netlify
1. 新建站点，连接仓库
2. Build command 留空
3. Publish directory 设为 `.`

## 对接真实数据（建议）

在 `app.js` 中找到：

```js
const dataAdapter = {
  async fetchSnapshot() { ... }
}
```

把其中“随机游走”的部分替换为：
- REST：`await fetch('/api/snapshot')`
- SSE：维护一个事件缓冲区，tick 时取最新
- WebSocket：同上

只要你返回每个 model 的最新 `value` 或完整 `values` 序列，就能驱动全站更新。

## 免责声明

本项目仅用于 UI/工程模板示例，不构成任何投资建议，也不包含真实交易逻辑。
