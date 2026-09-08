// factreach 工具：FactReach CLI 的只读入口（23 渠道体检 + 原生命令 transcribe/web/douyin）。
// 与 tavily-search.js 同构：固定 bin 路径 ~/.pi/agent/bin/factreach，不弹 shell。
// 平台级上游命令（yt-dlp/twitter/bili/gh 等）由 factreach skill 指引用 bash 直接跑，这里不重复包装。
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { ROUTER_MENU, LOC } from "./routing.js";

const FACTREACH = join(homedir(), ".pi", "agent", "bin", "factreach");

// 白名单：只放只读/产出命令；install/uninstall/setup/configure 走 bash + skill 指引（涉及写配置，需用户在场）
const COMMANDS = {
  doctor: ["doctor", "--json"],
  "check-update": ["check-update"],
  watch: ["watch"],
  version: ["version"],
  transcribe: ["transcribe"],
  web: ["web", "read"],
  douyin: ["douyin", "resolve"],
};

export const factreachTool = defineTool({
  name: "factreach",
  label: "FactReach 多平台检索（23 渠道）",
  description:
    ROUTER_MENU + "\n" +
    LOC.factreach +
    "\n\n用法：action=doctor 体检（默认 --json）；transcribe 转写视频/播客音频（target=URL或本地文件，extra_args 可加 -o 输出文件）；web 读任意网页（target=URL）；douyin 解析抖音分享链接（target=分享文本）。" +
    "\n只暴露只读命令；install/configure（写配置）与上游 CLI（yt-dlp/twitter/bili/gh）调用，按 factreach skill 的 references 用 bash 执行。",
  parameters: Type.Object({
    action: Type.String({ description: "命令：doctor | check-update | watch | version | transcribe | web | douyin" }),
    target: Type.Optional(Type.String({ description: "transcribe=音频/视频 URL 或本地文件；web=网页 URL；douyin=分享文本/短链" })),
    extra_args: Type.Optional(Type.String({ description: "追加参数（空格分隔，无 shell 解析），如 -o /tmp/transcript.txt" })),
  }),
  async execute(_toolCallId, params) {
    if (!existsSync(FACTREACH)) {
      return { content: [{ type: "text", text: "factreach 未安装（预期 ~/.pi/agent/bin/factreach）。安装：uv tool install --python 3.12 /tmp/fr/FactReach-main" }], isError: true, details: {} };
    }
    const action = String(params.action ?? "").trim();
    const argv = COMMANDS[action];
    if (!argv) {
      return { content: [{ type: "text", text: `不支持的 factreach 命令：${action}。可用：${Object.keys(COMMANDS).join(" / ")}` }], isError: true, details: {} };
    }
    const target = String(params.target ?? "").trim();
    if (target) argv.push(target);
    const extra = String(params.extra_args ?? "").trim();
    if (extra) argv.push(...extra.split(/\s+/).filter(Boolean));
    try {
      const stdout = execFileSync(FACTREACH, argv, {
        encoding: "utf-8",
        timeout: 120000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, PATH: `${homedir()}/.pi/agent/bin${process.env.PATH ? `:${process.env.PATH}` : ""}` },
      });
      return { content: [{ type: "text", text: stdout.slice(0, 60000) }], details: { argv } };
    } catch (e) {
      return { content: [{ type: "text", text: `factreach ${action} 失败：${String(e?.stdout || e?.message || e).slice(0, 1000)}` }], isError: true, details: { argv } };
    }
  },
});
