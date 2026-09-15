# Pi Agent V2

> 一个基于 **[pi](https://github.com/earendil-works/pi-coding-agent)** 构建的 **应用端 Harness**。

它不只是「把模型接上工具」。它想给模型补上三样东西：**审美**、**方法论**、**重点感**。

### 视觉：审美趣味与人文气息
**对话读起来像对话，不像日志。** 你说的话是一个石板色气泡（`#1e293b`）靠右；助手的回复**不加气泡**、就是正文本身，在 820px 的窄栏里居中流下来。一个 agent 回合结束时，整轮折叠成一行淡灰小字「N 个步骤」，展开才看得到中间过程（思考、工具行、研究轮次）——该安静的安静，该露的露。

**背景是活的。** 空会话时是一片会躲开鼠标的鸟群（Vanta BIRDS 的原生复刻，独立仓库 [birds-effect](https://github.com/yipengfeifei/birds-effect)）；开始对话后换成 88 个真实星座 + 519 颗真实星等星色的星空，鼠标靠近哪个星座才点亮它。

**克制得很具体。** 近黑而不是纯黑的底（`#1a1a1a`）、18px 面板圆角配 12px 控件圆角、输入框 15px 字号与 52px 起步高度、底部刻意留 108px 空——动效只发生在背景里，从不抢正文。

每处动效都是逐个调出来的：不好看就重做（同心环那版就是因为「太炫彩太土」被换掉的）。

### 提示词极简，能力做成工具
**完整 system prompt 实测 2,095 字符**：自定义 persona 683 + 项目规则（AGENTS.md）174 + 全局规则 890 + SDK 固定包装 348。

真正省下的不在 persona，而在**没进上下文的那部分**（合计 8,575 字符）：

| 如果都常驻 | 字符 | 本项目的做法 |
|---|---|---|
| pi 默认模板 | 约 2,577 | 换成 683 字符的 persona |
| 技能清单 | 5,519 | `noSkills`：清单不常驻，模型按 persona 里的指针自己 `ls` + `read` 去取 |
| 按需工具说明 | 479 | 收在三组里，解锁那一刻才注入 |

persona 只做三件事：说清「你是个在 pi 里干活的 agent」、给通道指针（`load_toolkit` 的组目录 + 技能库路径）、定两条编辑纪律（改现有文件用 `edit`，`write` 只用于新文件）。其余判断留给模型——**能力尽量做成工具，不写成规则**：往提示词里堆「遇到 X 要 Y」，每加一条都在给模型的推理加负担；做成工具，用不用由模型自己决定。

**工具多，但管得住。** 常驻只有 13 个：pi 原生 7 个（`read`/`bash`/`edit`/`write`/`grep`/`find`/`ls`）+ 6 个支撑（`search`/`recall`/`update_plan`/`wait_for`/`subagent`/`load_toolkit`）。其余 10 个收在三个组里（`web` 5 / `research` 2 / `orchestrate` 3），**碰到对应场景才解锁**，连用法索引都是解锁那一刻才注入。

工具面窄起手，上下文与注意力都留给任务本身。

### 抓得住重点、有方法论
- **研究引擎**：多轮循环 → 反证检查 → 收敛，并把结论沉淀成 expert skill 反复复用
- **任务编排**：先拆节点图（依赖关系、成功判据、每个节点的物料交接），再逐节点隔离执行——而不是让模型一口气「写个方案」
- **工具按需加载**：常驻核心之外分 `web` / `research` / `orchestrate` 三组，模型判断需要才解锁，窄工具面起手
- **25 个技能资产**：12 类节点 toolkit + 6 个 action + 执行纪律与专家档案

### 信息获取与多轮研究：由自研插件加强
统一 `search` 入口 + `tavily_search`（时效/指定域名）+ `factreach`（YouTube 字幕/播客转写/B站/抖音/RSS/学术/公众号等 23 渠道）+ `read_page`（页面内数据点：评论区/销量/商品数）+ `inspect_file`（本地 xlsx/csv/pdf 报价表）+ `browser`（真实浏览器，隔离空间内复用你的登录态，过反爬）+ `site_memory`（站点经验沉淀）

> **如果你的模型总是抓不住重点、做事缺少方法论、任务跑着跑着就偏了——这个 Harness 可能对你有帮助。**

---

# 项目交接文档

> **新会话/新 agent 先读本篇**（5 分钟接上全部上下文），细节再翻 `目标架构.md`（方案）+ `架构现状.md`（旧系统分析）。
> 本文件随进度原地更新，不追加历史说明。

---

## 1. 一句话

把旧 `~/Desktop/助手加思考融合版`（后端 monitor-server.js 14298 行 + 前端 26k 行，复杂度失控、上下文反复失忆）重构成 **V2**：后端 ~800 行自定义 + 90% 用 pi SDK，前端一个统一对话页 + 右上角画布，会话 = pi 原生 JSONL。

## 2. 用户拍板的需求（不可改）

1. **一个主对话界面**（沿用 Session UI 外观）：
   - 正常模式 = 模型自主决策：需要操作软件/环境 → 直接在对话里调工具干（Fable 5 模式）；纯输入输出型任务 → 模型自己生成多节点工作流，画布（照搬 WorkflowEditor 交互）显示在对话页右上角
   - 简单模式按钮（输入框右侧）= 纯净 pi：裸模型 + 默认工具，无任何定制提示词
2. **UI 保留清单**（用户逐个确认过）：
   - Session 的 **Skill / API / 顶上 Artifact** 保留
   - Workflow 的 **预览功能** 保留（artifactPreview 弹层：document/image/audio）
   - Execute 的 **合并消息逻辑** 保留（三源合并：持久消息/进度/乐观条目，running 活动与其返回折叠为一条）
3. **三个决策**（已拍板）：简单模式=会话级；节点图复用=模板库（`templates/` 目录存已跑通的带标注节点图）；工具=尽量保留（BUILTIN_SCHEMAS 18 个 + MCP 前缀全收编）
4. 能力一个不丢，丢的是实现它们的零件数量。

## 3. 为什么重构（旧系统痛点）

- monitor-server.js **14298 行**单文件：agent 循环 + orchestrate 状态机 + 44 API 端点 + masterSession（**160 条截断**，上下文失忆根源）
- **三套会话模型**（agent jsonl / masterSession / workflow ledger）→ V2 一套 pi JSONL
- **两套前端 hook**（useAgentSession 38 处 effect / useOrchestrate 29 处）→ V2 一个 usePiSession
- 29 个 app/api route 直读文件与代理 3000 混用

## 4. V2 骨架

> **单一事实源（必读，防漂移）**：`backend/`（根目录）是唯一可维护的后端源码；`electron/backend/` 与 `electron/dist/` 是 `npm run build:app` 生成的构建产物，**禁止手工修改**。改 backend 后运行 `cd electron && npm run build:app` 重新生成产物；文档与代码脱节时改文档对齐代码，不追加“已知偏差”说明。

```
backend/  server.js（~110 行 WS 事件桥 + pi SDK） 端口 4700
  ├─ 命令：prompt / steer / followUp / abort / new_session
  ├─ 断点续跑：重连即 SessionManager.continueRecent(CWD)
  ├─ 工具：plan / worker / research（多轮研究引擎）/ search / site_memory / wait_for / run_status
  ├─ 未来：tools/{plan,worker,subagent,browser,gather}.js（defineTool 注册）
  └─ 未来：tools/node-types.js（12 类节点静态映射，详见 目标架构.md §11）
skills/   12 个 node-*-toolkit + 7 个 action-* SKILL.md 原样收编（纯文本资产，零依赖）
frontend/ Next.js（端口 3102）+ hooks/usePiSession + app/page.tsx
  └─ 未来：右上角画布（只读）、Skill/API 面板、SessionSidebar
```

**12 类节点融入方式（一句话）**：节点类型体系保留，但组装从"运行时压缩 SKILL.md 拼 prompt"换成 pi 原生 skill 机制（worker 给节点带 skillIds，模型按需读文件）——提示词资产与代码解耦。详见 `目标架构.md` §11。

详细模块清单见 `目标架构.md` §1-§5。

## 5. 进度

| 状态 | 项 | 验证 |
|---|---|---|
| ✅ | 后端最小闭环（WS 事件桥 → pi agent 循环 → 流式） | `cd backend && node test-client.mjs` PASS |
| ✅ | 前端最小闭环（usePiSession + 聊天页：流式/工具活动/新会话/Shift+Enter steer/abort） | 浏览器实测通过 |
| ✅ | 消息渲染层（MarkdownBody 照搬 + thinking 折叠 + katex + 代码高亮 + streaming 节流） | 浏览器实测通过 |
| ✅ | plan/worker 工具骨架（plan 拆图/direct 判定；worker 干净上下文执行 + 依赖校验 + 物料交接） | `node worker-test.mjs` + 端到端实测通过 |
| ✅ | 12 类节点资产收编（skills/ 21 个 SKILL.md：12 toolkit + 6 action + 2 支撑） | 文件复制，零适配 |
| ✅ | 画布只读版（NodeCanvas：拓扑分层节点图 + 状态 ✓/⏳/○ + 点击预览弹层） | 浏览器实测通过（3 节点全 ✓ + 预览弹层） |
| ✅ | 工具收编第一批（http_request + execution_app_snapshot；浏览器走 ego-browser skill；文件类 pi 原生） | worker 实测：http 200/ok、Finder 快照正常 |
| ✅ | 弱模型路由（worker 用便宜模型跑节点） | — |
| ✅ | 简单模式按钮（裸 pi 会话：无 plan/worker 工具，会话级切换） | 浏览器实测：简单模式直接对话，切回正常 |
| ✅ | subagent 工具（pi 官方扩展，不自己写；single/parallel/chain 三模式 + 独立进程隔离） | 实测：parallel 2/2 成功 |
| ✅ | Skill 面板（get_skills/set_skill_disabled 命令 + SkillsPanel 照搬旧 toggle 逻辑） | 实测：47 个 skill 列出，toggle 写 frontmatter |
| ✅ | plan 两阶段化（Stage 1 意图漏斗：信息四分类 + needsClarification + requiredMaterials；Stage 2 拆图带 successCriteria/serves） | 单测 + 端到端实测 |
| ✅ | 画布三态（未激活 ○/工作中 ⏳/卡住 ⚠；完成=有产出）；不造控制命令（"继续"靠模型自主判定，实测通过） | 浏览器实测 |
| ✅ | Execute 补齐（进度文本流：节点级 ⏳/完成/卡住；会话侧边栏：列表/切换/删除/历史重放） | 浏览器实测：切换会话 40 条历史恢复 |
| ✅ | wait_for 定时唤醒工具（等邮件/工单/审批，到点 followUp 自动继续） | 实测：模型自主调用，0.5 分钟到点自动唤醒第 2 轮 |
| ✅ | 节点图 runId（plan 拆图带 runId/title；node_output 带 (runId,nodeId)；worker 按 runId 隔离依赖→修跨图串 n1 的 bug；list_runs 返回各 run 进度） | 单测：跨图隔离/依赖拒绝/物料传递通 |
| ✅ | 节点实时心跳（worker 执行中 text_delta → node_progress 事件 → 前端节点行点击展开查看，如终端实时滚动） | 后端启动验证 + tsc 通过 |
| ✅ | Artifact 会话级产物条（主会话 write + 节点产出合并；判定=交付物：CWD 内 + 扩展名白名单 md/doc/docx/pdf/html/图片 + 产出型节点；json/py/csv 等中间格式不收） | `node artifacts-test.mjs` + 浏览器实测 |
| ✅ | API/模型配置面板（get_models 列 provider/模型 + set_api_key 写 AuthStorage；ModelsPanel 弹层） | 实测 8 provider / 336 模型 |
| ✅ | 模板库（templates/ 目录：save_template 存当前图 / list_templates / load_template 载入执行，去 runId 加新 runId） | 逻辑自测通过 |
| ✅ | 死代码清理（删 RightRail/ActivityStream/LineSidebar orphan 组件） | tsc 通过 |
| ✅ | ego-browser 收编（.pi/skills/，worker/主 agent 浏览器能力） | 实测：打开 example.com 报告标题 |
| ✅ | **research 多轮研究引擎**（tools/research.js：价值分层→强制收敛→聚焦轮；收敛自动沉淀 expert-* skill；决策截止；research_round custom entry 存状态） | 端到端实测：2 轮收敛 244s（比 3 轮制快 43%），自动生成 expert-tiktok-us-fidget.md；解压玩具任务产出条件式 do 结论（test-research.mjs） |
| ✅ | **investigator 取证 agent**（~/.pi/agent/agents/investigator.md：免费通道优先、ego-browser 过反爬、方法约束注入） | 实测：1688 滑块后抓 5 关键词真实数据、发现"珍珠收纳盒"关键词双义 |
| ✅ | **会话懒清理**（server.js cleanupTempSessions：--private-tmp-* 超 1 天删除） | 实测：771 → 0 个临时会话目录 |
| ✅ | **new_session 竞态修复**（open 串行化） | 实测：new_session 正确创建新会话（此前会续旧会话污染测试） |
| ✅ | **browser 工具**（backend/tools/browser.js：封装 ego-browser 为 defineTool，模型不再 bash heredoc；worker/主 agent 均注册） | 实测：打开 1688 搜索页提取文本（spawn+stdin，cliLog 走 stderr） |
| ✅ | **工具活动行虚拟识别**（前端 classifyBash：bash 命令→真实操作图标，ego-browser→browser 网页图标/anysearch→search/curl→http/python→code/node→terminal/ls/grep/find→对应） | TS 通过，前端 HMR 生效 |
| ✅ | **research 进度消息**（research_progress 事件：轮次动态分区 + MarkdownBody 产出 + 折叠信息流 + 完成结论速览） | 后端 emit + 前端分区渲染（复用 NodeCanvas 的 MarkdownBody 路径） |
| ✅ | **subagent 取证员**：拆 N 条独立活动行 + 子进程实时心跳（扩展 processLine 解析 text_delta → 全局 emitter → 前端） | investigator agent + 4 条并行独立信息流 |
| ✅ | **FLY 桌面壳**（electron/main.js：静态服务 + 后端子进程，WS 4800；后端优先系统 node——Electron 内置 node 的 c-ares 会 SIGILL 崩溃，无系统 node 时回退 utilityProcess；看门狗：后端崩了自动重启，前端 2s 重连恢复；窗口 668×595 按终端尺寸）；build-app.mjs 一键打包（前端静态导出 + backend + .pi 全进包） | `cd electron && npm run build:app` → dist/mac/FLY.app；打包版实测：47 skills / 全链路回复 |
| ✅ | **斜杠命令层 + 分支**（pi 原生方法补齐：`/help` `/model <关键词>`（setModel，模糊匹配）`/compact`（SDK 原生压缩）`/queue on\|off`（steering+followUp all）；输入框 `/` 开头前端拦截（SDK 会把 / 当扩展命令/模板展开）；分支 = 消息上「↳ 分支」按钮 → createBranchedSession 复制根→分支点为独立会话并切换（原会话保留，user-only 分支需 `_rewriteFile` 强制落盘）；history 重放带 entryId（分支按钮数据源）） | `node branch-test.mjs`（sessionManager 层）+ `node commands-test.mjs`（WS 层真实 LLM）PASS；浏览器实测：/help /model（model_change 条目写入）/queue /compact（小会话 SDK 拒绝=链路通）/分支切会话且历史裁剪正确 |
| ⏭ | mailpit/calendar/mcp 按需收编 | — |

## 6. 运行方式

```bash
# 后端（4700）
cd ~/Desktop/pi\ Agent\ V2/backend && node server.js
# 冒烟测试
cd backend && node test-client.mjs
# research 端到端（干净会话）
cd backend && node test-research.mjs "<研究型任务>" 900000
# 前端（3102）
cd ~/Desktop/pi\ Agent\ V2/frontend && npm run dev
# 浏览器访问 http://127.0.0.1:3102
```

## 7. 踩过的坑（别再踩）

1. **pi SDK 事件里 assistant message 无 id** → 前端按 turn 自增序号合并（`message_update/end` 与 `turn_end` 同条目）；`message_end` 的 content 可能只有 thinking，`turn_end` 才有完整 text
2. **Next dev 被 127.0.0.1 访问时 HMR 跨域拦截 → 页面不水合** → `next.config.ts` 加 `allowedDevOrigins: ["127.0.0.1","localhost"]`
3. 后端 node 监听 IPv6 双栈；测试客户端/前端 WS 用 `127.0.0.1`（`localhost` 有解析问题）
4. 工具活动条目：`tool_execution_start`（running）→ `tool_execution_end` 折叠为一条（Execute 合并逻辑简化版）
5. MarkdownBody 照搬时：固定 `isDark=true`（不搬 useTheme store）；砍 MermaidBlock（动态 import mermaid 依赖太大，需要时再加）
6. **节点指令“内容可被下游消费”会把交付物写成 .json**（用户不会要 json 当交付物）→ 终端节点（无下游消费者）指令改为面向用户写 .md/.html/图片，非终端节点才写机器格式；判定函数 `artifacts.js`（server + worker 共用），旧 node_output 无 nodeType 时从 node_graph 按 runId:nodeId 反查，判定不降级
7. **research 工具踩坑**：① execute 内循环变量用 const 声明后赋值 → 抛 "Assignment to constant variable"，SDK 把它当 toolResult 返回，模型直接 agent_end（工具层异常必须 try/catch + console.error 落日志，别指望 SDK 透传）② 单轮无超时 + 搜索次数不限 → 模型限流时单轮卡十几分钟，用户等不及打断（已加：每轮 5 分钟超时 + 协议限搜索次数 2/3/2 + RESEARCH_DEBUG 进度日志）③ 工具一次失败（网络/被打断）后模型会失去信任绕开它 → 测试必须用干净会话，续接旧会话会带着失败记忆
8. **A/B/C 对比实验结论（纯知识 vs 纯搜索 vs research 引擎）**：搜索 > 知识（B 实测发现关键词双义，A 纯印象且自信给错细节）；research 独有的价值是反证击穿（h4 毛利假设被真实行业净利率击穿，B 的最终结论里就藏着同款错误）；skill 复用让后续任务 8 分钟达到接近首次研究深度
9. **new_session 竞态**（2026-08-10 修）：连接建立时首次 open（续旧会话）未完成时 new_session 到达 → 两次 open 并发互相覆盖 session 变量 → 新会话被旧会话覆盖。修复：open 串行化（openChain 队列）。另：测试脚本要等第 2 次 ready（第 1 次是连接初始 open）
10. **研究效率演进**：3 轮制 432s → 价值分层 400s → 强制收敛 2 轮 244s。根因：时间大头是模型输出全字段 JSON 不是搜索；secondary 不深挖省不了输出 token。最终形态：round1 开题分层 / round2 强制收敛+沉淀 skill / round3+ 聚焦轮（只处理未定案 essential，精简 delta，无新增证据必须收敛），MAX_ROUNDS=5 兜底

## 8. 会话协议（防断档）

- 每次会话开始：读本文件 + `目标架构.md`（§9/§10 是进度段）
- 会话结束前：把产出/踩坑/下一步更新进本文件 §5/§7 与 `目标架构.md` 进度段（原地改写，不追加）
- 大块工作按 §5 顺序推进，每步先验证再收尾
