# demos/

开发过程中做的**单文件效果/组件 demo** —— 直接用浏览器打开即可，跟主应用**无关**，也不是入口。

> **要跑主应用请看根目录 [README.md](../README.md) 第 6 节「运行方式」。**

| 文件 | 是什么 |
|---|---|
| `star-chart-yellow.html` / `su-28-star-chart.html` | 星空背景的原始版本（后端 `StarChart.tsx` 的星座数据就内嵌自这里） |
| **`pi-agent-chat-stars.html`** | **星空背景的现行版本 —— 也是 `frontend/components/starfield/engine.js` 的唯一源。改引擎改这里，然后跑 `node scripts/port-starfield.mjs` 重新移植。** |
| `star-chart-data.js` | 88 星座 + 519 真实星（从 `StarChart.tsx` 原样抽出，供独立 demo 用；组件里直接 import StarChart） |
| `star-bg-inject.js` / `star-bg-inject-README.md` | 注入版：把星空挂到跑着的前端上（DevTools Console 粘贴即可），改版探索期用 |
| `capture.mjs` | CDP 逐帧抓取脚本（`PAGE=` `CURSOR=` `VIEW=` `ENGAGE=` 环境变量控制），用来把 demo 录成 mp4 |
| `krea-agent-hero.html` | Krea Agent 落地页 hero 的复刻（引力透镜 shader 的来源），星空引擎的上游 |
| `border-glow-demo.html` / `input-glow-demo.html` | BorderGlow 组件的来源（官方 reactbits 样式，逐字节比对用） |
| `icon-size-demo.html` | 图标尺寸对照（带滑块，对着 macOS 红黄绿三点调 18px 那个定稿） |
| `markdown-render-demo*.html` | Markdown 渲染层比对 |
| `plan-panel-demo.html` / `research-progress-demo.html` / `tool-expand-demo.html` / `search-expand-demo-v4.html` / `artifact-bar-demo.html` / `browser-parallel-demo.html` / `fold-demo.html` | 各类交互面板的设计稿 |
| `agent-message-icons.html` / `tool-icons-demo.html` / `ui-redesign-demo.html` / `hover-gradient-demo.html` | 图标与视觉改版的探索 |
