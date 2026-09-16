// 工具组加载器：常驻核心之外的工具按场景分组，模型判断需要哪一组时调用本工具解锁。
//
// 为什么是「工具」而不是「skill」——
//   pi 的 Skill 接口只有 name/description/filePath/baseDir/sourceInfo/disableModelInvocation
//   （dist/core/skills.d.ts:9-16），**没有 allowed-tools**，技能无法声明「我要带出哪些工具」。
//   SDK 侧确实没有钩子：session.subscribe 的监听器是 (event) => void，纯通知，改不了调用。
//   但扩展侧**有** pi.on("tool_call")，能 block、能就地改参数（types.d.ts:691）。
//   它救不了这件事，原因是另一条：ExtensionContext.sessionManager 是 ReadonlySessionManager，
//   拿不到 setActiveToolsByName（types.d.ts:219）—— 扩展能拦调用，但改不了工具面。
//   注：2026-09 前这里写的是「SDK 没有工具调用钩子（全空）」，把两套 API 混成一套，
//   会让后来者不再去找 pi.on("tool_call")，故更正。
//   唯一能改工具面的入口是 session.setActiveToolsByName（dist/core/agent-session.d.ts:287），
//   必须由代码主动调用 —— 因此「组」的载体只能是工具。
//
// 设计要点：
//   · 本文件是**唯一的工具面配置源**。改分组只改这里，server.js 不再散落工具名清单。
//   · 加载是幂等的、可叠加的（后加载的组并入已有集合，不会把已解锁的工具踢掉）。
//   · 描述里只写「什么时候用哪组」，具体用法留在各工具自己的 description（调用时才注入）。
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ROUTER_MENU } from "./routing.js";

// ── 常驻核心：每次请求都在，属于「任何任务都可能用到」的通用能力 ──
// 注意：read 必须常驻 —— SDK 只在 read 可用时才注入 skills 清单（core/system-prompt.js:112）
export const TOOLKIT_CORE = [
  // SDK 原生编辑/检索能力
  "read", "bash", "edit", "write", "grep", "find", "ls",
  // 通用支撑
  "search",        // 通用搜索：查事实/数据/资料/资讯（用户明确要求常驻）
  "recall",        // 跨会话检索：用户提到本轮没出现过的东西时用
  "update_plan",   // 轻量步骤清单
  "wait_for",      // 等外部事件（邮件/审批/工单）后自动唤醒
  "subagent",      // 子体（由 pi 扩展注册；不在注册表时会被忽略）
  // 本加载器自身
  "load_toolkit",
];

// ── 按需工具组 ──
// tools 里的名字必须与 backend/server.js 的 customTools 实际注册名一致，
// 否则 setActiveToolsByName 会静默忽略（未注册的名字不报错，只是不生效）。
export const TOOLKITS = {
  web: {
    when:
      "要抓外部资料/数据：时效资讯或指定域名、平台深度内容（YouTube 字幕/播客转写/抖音/B站/RSS/学术/公众号）、" +
      "页面内数据点（评论区/销量/商品数）、本地 xlsx/csv/pdf 报价表或榜单、反爬或需登录态的站点",
    tools: ["tavily_search", "factreach", "read_page", "inspect_file", "browser"],
    route: ROUTER_MENU, // 加载时随返回内容注入；不再挂进各工具 description（避免 4 份重复）
  },
  research: {
    when:
      "需要方法论/专家判断的研究型任务（选品、市场进入、投研、方案论证）——" +
      "内部自动跑多轮研究循环 + 反证检查 + 收敛，并沉淀 expert skill",
    tools: ["research", "site_memory"],
  },
  orchestrate: {
    when:
      "任务要拆成多步节点图并逐节点执行（步骤间有数据依赖、需隔离执行或并行分支）",
    tools: ["plan", "worker", "run_status"],
  },
};

export const TOOLKIT_NAMES = Object.keys(TOOLKITS);

/** 组目录：给模型看的「哪个场景用哪组」，也是本工具 description 的主体。 */
export function toolkitMenu() {
  return TOOLKIT_NAMES.map((k) => `· ${k} — ${TOOLKITS[k].when}`).join("\n");
}

/**
 * @param {() => string[]} getActive  当前已解锁的工具名
 * @param {(names: string[]) => void} setActive  应用新的工具面（幂等，只增不减）
 * @param {(group: string) => void} [onGroupLoaded]  解锁某组后的持久化回调（server 写成会话条目）
 */
export function createToolkitLoader({ getActive, setActive, onGroupLoaded }) {
  return defineTool({
    name: "load_toolkit",
    label: "加载工具组",
    description:
      "常驻核心之外还有几组「专门工具」，按场景加载（加载后本会话保持，不必重复调用）。\n" +
      "分组目录：\n" +
      toolkitMenu() +
      "\n判断权在你：确认当前任务确实需要某组能力时才调；一次加载一组，加载完直接继续干活。",
    parameters: Type.Object({
      group: Type.String({
        description: `要加载的组名，可选：${TOOLKIT_NAMES.join(" / ")}`,
      }),
    }),
    execute: async (_toolCallId, params) => {
      const g = String(params?.group ?? "").trim().toLowerCase();
      const kit = TOOLKITS[g];
      if (!kit) {
        return {
          content: [
            {
              type: "text",
              text: `未知工具组「${g}」。可选：${TOOLKIT_NAMES.join(" / ")}。`,
            },
          ],
          details: { isError: true },
        };
      }
      const before = new Set(getActive());
      const next = Array.from(new Set([...before, ...kit.tools]));
      const added = kit.tools.filter((t) => !before.has(t));
      setActive(next);
      // 只在真的解锁了新工具时才落条目：重复加载同一组不写脏数据
      // （之前每调一次都写一条，同一会话攒了十几条同内容的 token）
      if (added.length > 0) {
        try { onGroupLoaded?.(g); } catch { /* 持久化失败不影响本次解锁 */ }
      }
      return {
        content: [
          {
            type: "text",
            text:
              `已加载「${g}」组：${added.join(", ")}。现在可以直接调用。` +
              (kit.route ? `\n\n${kit.route}` : `\n具体用法见各工具自己的 description。`),
          },
        ],
        details: { group: g, added, active: next },
      };
    },
  });
}
