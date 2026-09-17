# star-bg-inject.js —— 把星空背景注入正在跑的 Pi Agent V2

## 怎么用（30 秒）

1. 确保 dev server 在跑（`./start-dev.sh`，前端在 http://localhost:3102）
2. 浏览器打开 http://localhost:3102
3. 打开 DevTools → Console
4. 把 `star-bg-inject.js` 整个文件内容粘进去，回车

会看到：原来的 StarChart / BirdsField 画布被藏掉，换成两层星空（粒子氛围 + 519 真实星 / 88 星座），
引力透镜绑定在 `.border-glow-card` 上 —— 也就是你真实的输入框。

右下角会出现一个胶囊，显示动态开关 / 系统 prefers-reduced-motion / WebGL 状态。点它或按 F 切换。

## 它挂在哪几个节点上

| 用途 | 选择器 |
|---|---|
| 指针事件根 | `document.body` |
| 引力透镜的质点 | `.border-glow-card`（BorderGlow 组件） |
| 输入框 focus/blur | `.border-glow-card textarea` |
| 自己创建的 | `#__bgScene` `#__bgLabels` `#__bgNote` `#__bgFail` |

## URL 参数（注入版本读不到，改成在文件末尾改常量）

| 常量 | 默认 | 作用 |
|---|---|---|
| `DUST_V` | 0.30 | 粒子亮度 |
| `skyUniforms.skyDim` | 0.60 | 真实星图整层亮度 |
| `twinkle` | 0.75 | 闪烁幅度 |
| `CALM_SPIN` | 0.055 rad/s | 自转速度 |
| `COUNT` | 1200×5 | 粒子数量（density 参数） |

## 要真接进产品该怎么做

这段就是一段独立 module，输入只有三个 DOM 节点。把它搬成 `useEffect`：
`promptEl` 指向 `BorderGlow` 的 ref，`hero` 换成窗口，删掉自建的 canvas 改成 JSX 里的两个 `<canvas>`。
然后可以删掉 `components/StarChart.tsx` 和 `components/BirdsField.tsx`。
