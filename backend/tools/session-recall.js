// recall 工具：跨会话回忆 —— 在同一个项目的历史会话里抓词、取片段、按需展开
//
// 设计（2026-09-12 定稿）：
//   模型管：抓什么词 / 怎么抓 / 何时抓 / 片段里挑哪一个 / 要不要换词重筛
//   工具管：去哪抓（范围）/ 抓多少（片段与条数）/ 第二次怎么抓（精读）/ 排序
//   底线：**原文是唯一权威**。本工具只做"把模型送到原文"，不摘要、不做语义判断。
//
// 为什么不用 FTS5 / 倒排索引（本机实测结论，勿重复踩坑）：
//   · 语料真实文本只有 ~1.85 MB（原始 JSONL 167 MB 的 1%，其余全是 thinking/工具参数/工具输出）
//   · 纯 JS 内存字面扫描 6.75 ms，比 rg 扫原始（204 ms）快约 30 倍；抽取一次 4.1 s，之后增量
//   · SQLite FTS5 trigram 对中文两字词（选品 / 打包…）**0 命中**，前缀 `x*` 与引号 `"x"` 补救均无效
//   · FTS5 unicode61 只匹配被标点界定的完整中文串，「选品的」直接 0
//   · 自切 bigram 能搜两字词，但 snippet() 返回的是变形文本（"帮我我研研究究…"），不可读 → 废
//   · node:sqlite 还需 --experimental-sqlite 启动参数，会动到启动脚本
//   升级门槛：真实文本涨到 50–100 MB 以上，或需要前端逐字实时搜索时，再考虑索引方案。
//
// 缓存：~/.pi/agent/sessions-text-cache/<归档目录>/<会话短号>.txt（JSONL，每行一条消息）
//       仅缓存"可读文本"，供快速扫描；精确内容一律回原始 JSONL 取。
import { defineTool, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SESSIONS_DIR = () => path.join(getAgentDir(), "sessions");
const ARCHIVE_DIR = () => path.join(getAgentDir(), "sessions-archive"); // 归档区（可能不存在）
const CACHE_DIR = () => path.join(getAgentDir(), "sessions-text-cache");
const MANIFEST_FILE = () => path.join(CACHE_DIR(), "manifest.json");

const SCAN_LIMIT_DEFAULT = 10;
const SCAN_LIMIT_MAX = 20;
const WIDTH_DEFAULT = 200;
const WIDTH_MAX = 400;
const SPAN_DEFAULT = 2;
const SPAN_MAX = 10;
const OUT_MAX_CHARS = 24000; // 单次返回硬上限，防灌爆上下文

const state = {
  manifest: null, // { dirs: { [dirName]: { cwd } }, files: { [abs]: { mtimeMs, size } } }
  byFile: new Map(), // abs -> records[]
  records: [], // 展平后的记录（当前范围）
};

// ─────────────────────────── 缓存与抽取 ───────────────────────────

function loadManifest() {
  if (state.manifest) return state.manifest;
  state.manifest = { dirs: {}, files: {} };
  try {
    if (existsSync(MANIFEST_FILE())) {
      const m = JSON.parse(readFileSync(MANIFEST_FILE(), "utf8"));
      state.manifest = { dirs: m.dirs || {}, files: m.files || {} };
    }
  } catch {
    /* 损坏就当空 */
  }
  return state.manifest;
}

function saveManifest() {
  try {
    mkdirSync(CACHE_DIR(), { recursive: true });
    writeFileSync(MANIFEST_FILE(), JSON.stringify(state.manifest));
  } catch {
    /* 缓存写不了不影响检索，只是下次重建 */
  }
}

function archiveDirs() {
  const out = [];
  for (const root of [SESSIONS_DIR(), ARCHIVE_DIR()]) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const p = path.join(root, name);
      try {
        if (statSync(p).isDirectory()) out.push({ name, path: p });
      } catch {
        /* 跳过无权限项 */
      }
    }
  }
  return out;
}

// 归属权威 = JSONL 第一行 header 的 cwd 字段。
// 目录名编码有损不可逆（server.js 注释亦如此说明），所以只编码用于兜底猜测，判定一律读 header。
function firstCwdOf(dirPath) {
  try {
    for (const f of readdirSync(dirPath)) {
      if (!f.endsWith(".jsonl")) continue;
      const head = readFileSync(path.join(dirPath, f), "utf8").split("\n", 1)[0];
      const d = JSON.parse(head);
      if (d && d.cwd) return String(d.cwd);
    }
  } catch {
    /* 目录里没有可解析会话 */
  }
  return null;
}

function guessDirName(cwd) {
  return "--" + String(cwd).replace(/^\//, "").replace(/\//g, "-") + "--";
}

function shortId(fileName) {
  const base = fileName.replace(/\.jsonl$/, "");
  const tail = base.includes("_") ? base.split("_").pop() : base;
  return tail.replace(/[^0-9a-zA-Z]/g, "").slice(0, 8) || base.slice(0, 8);
}

// 只抽可读正文：type==='message' 且 role ∈ {user, assistant} 且有 text。
// 跳过 thinking / tool_call / tool_result —— 那些是噪音，占了原始体积的 99%。
function extractRecords(abs) {
  const out = [];
  let raw;
  try {
    raw = readFileSync(abs, "utf8");
  } catch {
    return out;
  }
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (!L.trim()) continue;
    let d;
    try {
      d = JSON.parse(L);
    } catch {
      continue;
    }
    if (d.type !== "message") continue;
    const role = d.message && d.message.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = d.message && d.message.content;
    let text = "";
    if (Array.isArray(content)) {
      text = content
        .filter((c) => c && c.type === "text")
        .map((c) => c.text || "")
        .join(" ");
    } else if (typeof content === "string") {
      text = content;
    }
    text = text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    out.push({ ts: String(d.timestamp || "").slice(0, 16).replace("T", " "), role, line: i, text });
  }
  return out;
}

/** 从缓存 .txt 直接载入（比重新解析 JSONL 快一个量级；缓存就为此而存在） */
function loadCachedRecords(cacheFile, abs, cwdOfFile, sid) {
  try {
    const out = [];
    for (const L of readFileSync(cacheFile, "utf8").split("\n")) {
      if (!L.trim()) continue;
      const o = JSON.parse(L);
      out.push({ ts: o.ts, role: o.role, line: o.line, text: o.text, sid, cwd: cwdOfFile, abs });
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * 增量刷新：按源文件 mtime+size 判断是否需要重抽。
 * scope='project' 只处理命中当前 cwd 的归档目录（首调用约数秒，之后毫秒级）。
 */
function refresh(cwd, scope) {
  const m = loadManifest();
  const all = archiveDirs();

  // 目录 → cwd 映射（首次读 header，之后用缓存）
  for (const d of all) {
    if (!m.dirs[d.name]) m.dirs[d.name] = { cwd: firstCwdOf(d.path) };
  }

  let wanted = all;
  if (scope !== "all") {
    const matched = all.filter((d) => m.dirs[d.name].cwd === cwd);
    wanted = matched.length ? matched : all.filter((d) => d.name === guessDirName(cwd));
  }

  const cacheRoot = CACHE_DIR();
  const seen = new Set();
  let extracted = 0;
  let removed = 0;
  const t0 = Date.now();

  for (const d of wanted) {
    let entries;
    try {
      entries = readdirSync(d.path);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith(".jsonl")) continue;
      const abs = path.join(d.path, f);
      seen.add(abs);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      const prev = m.files[abs];
      const sid = shortId(f);
      const cwdOfFile = m.dirs[d.name].cwd || cwd;
      const cacheFile = path.join(cacheRoot, d.name, sid + ".txt");

      // 文件未变：优先读缓存（新进程首次调用也走这里，避免重新解析 167MB JSONL）
      if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) {
        if (state.byFile.has(abs)) continue;
        const cached = loadCachedRecords(cacheFile, abs, cwdOfFile, sid);
        if (cached) {
          state.byFile.set(abs, cached);
          continue;
        }
      }

      // 新增或已变更：重新抽取并回写缓存
      const recs = extractRecords(abs).map((r) => ({ ...r, sid, cwd: cwdOfFile, abs }));
      state.byFile.set(abs, recs);
      m.files[abs] = { mtimeMs: st.mtimeMs, size: st.size, dir: d.name, sid };

      try {
        mkdirSync(path.join(cacheRoot, d.name), { recursive: true });
        writeFileSync(cacheFile, recs.map((r) => JSON.stringify(r)).join("\n"));
      } catch {
        /* 缓存写失败不影响本次检索，只是下次要重建 */
      }
      extracted++;
    }
  }

  // 清掉已消失的文件（仅在本次扫描范围内）
  for (const abs of Object.keys(m.files)) {
    const dirName = path.basename(path.dirname(abs));
    if (seen.has(abs) || !wanted.some((d) => d.name === dirName)) continue;
    delete m.files[abs];
    state.byFile.delete(abs);
    removed++;
  }

  // 展平当前范围的记录
  const poolNames = new Set(wanted.map((d) => d.name));
  state.records = [];
  for (const [abs, recs] of state.byFile) {
    if (poolNames.has(path.basename(path.dirname(abs)))) state.records.push(...recs);
  }

  // 去重：同一会话在历史上被写进过两个不同 cwd 的归档（文件名带 -N 后缀的副本），
  // 内容逐字相同 → 不去重会让每条命中返回两遍。按 (时间|角色|全文) 判同一，保留先遇到的。
  const seenKeys = new Set();
  const deduped = [];
  for (const r of state.records) {
    const k = r.ts + "|" + r.role + "|" + r.text;
    if (seenKeys.has(k)) continue;
    seenKeys.add(k);
    deduped.push(r);
  }
  const dupRemoved = state.records.length - deduped.length;
  state.records = deduped;

  // 只在真有变化时回写 manifest，避免每次调用都写盘
  if (extracted || dupRemoved || removed) saveManifest();
  return { extracted, ms: Date.now() - t0, dirs: wanted.length, msgs: state.records.length, dupRemoved };
}

// ─────────────────────────── 检索与片段 ───────────────────────────

function readRange(absPath, keepNewlines) {
  const msgs = [];
  let raw;
  try {
    raw = readFileSync(absPath, "utf8");
  } catch {
    return msgs;
  }
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (!L.trim()) continue;
    let d;
    try {
      d = JSON.parse(L);
    } catch {
      continue;
    }
    if (d.type !== "message") continue;
    const role = d.message && d.message.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = d.message && d.message.content;
    let text = Array.isArray(content)
      ? content
          .filter((c) => c && c.type === "text")
          .map((c) => c.text || "")
          .join(" ")
      : typeof content === "string"
        ? content
        : "";
    text = keepNewlines ? text.replace(/[ \t]+/g, " ").trim() : text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    msgs.push({ line: i, role, ts: String(d.timestamp || "").slice(0, 16).replace("T", " "), text });
  }
  return msgs;
}

function makeSnippet(text, idx, wordLen, width) {
  const s = Math.max(0, idx - width);
  const e = Math.min(text.length, idx + wordLen + width);
  return (s > 0 ? "…" : "") + text.slice(s, e) + (e < text.length ? "…" : "");
}

/** 粗筛：多关键词语义无关的字面命中，按「覆盖词数 → 用户消息优先 → 时间近」排序 */
function scan({ words, limit, width }) {
  const list = (Array.isArray(words) ? words : String(words || "").split(/[\s,，、]+/))
    .map((s) => String(s).trim().toLowerCase())
    .filter(Boolean);
  if (!list.length) return null;

  const hits = [];
  for (const r of state.records) {
    const low = r.text.toLowerCase();
    let cov = 0;
    let bestIdx = -1;
    let bestWord = "";
    for (const w of list) {
      const i = low.indexOf(w);
      if (i < 0) continue;
      cov++;
      if (bestIdx < 0 || i < bestIdx) {
        bestIdx = i;
        bestWord = w;
      }
    }
    if (cov > 0) hits.push({ r, cov, idx: bestIdx, word: bestWord });
  }

  const total = hits.length;
  const sessionCount = new Set(hits.map((h) => h.r.sid)).size;
  const userCount = hits.filter((h) => h.r.role === "user").length;

  hits.sort(
    (a, b) =>
      b.cov - a.cov ||
      (a.r.role === "user" ? 0 : 1) - (b.r.role === "user" ? 0 : 1) ||
      (a.r.ts < b.r.ts ? 1 : a.r.ts > b.r.ts ? -1 : 0),
  );

  // 同一位置只返回一次（防重复副本残留）
  const seenPos = new Set();
  const uniq = [];
  for (const h of hits) {
    const k = h.r.sid + ":" + h.r.line;
    if (seenPos.has(k)) continue;
    seenPos.add(k);
    uniq.push(h);
  }

  const picked = uniq.slice(0, limit);
  return { hits: picked, total: uniq.length, sessionCount, userCount, words: list, width };
}

// ─────────────────────────── 工具定义 ───────────────────────────

export function createSessionRecallTool({ cwd } = {}) {
  const projectCwd = cwd || process.cwd();

  return defineTool({
    name: "recall",
    label: "跨会话回忆（抓词 → 瞄一眼 → 展开）",
    description:
      "在同一个项目的历史会话里抓词、取片段、按需展开。原文是唯一权威，本工具不做摘要。\n" +
      "\n" +
      "何时用：用户提到了**本轮对话里没出现过**的东西 ——「你记得那个 XX 吗」「上次我们怎么怎么样」，" +
      "或突然冒出一个本轮没交代来源的专名。这是唯一的触发条件。\n" +
      "不要用于：通用知识能答的、材料已在上下文里的、闲聊与措辞调整、单点事实查询。\n" +
      "\n" +
      "两轮用法：先 scan 抓词 → 看片段挑最相关的 → 再 read 展开那一条。\n" +
      "· scan：抓**唯一性高的词**（专名 / 事件名 / 决定名），不要动词和泛词；一个词就够，不必造句。" +
      "抓不到就换几个近义词再试 —— 当时可能叫别的名字。\n" +
      "· read：用 scan 返回的 id（形如 a3f2:128），展开该条完整内容 + 前后各 N 条消息。\n" +
      "纪律：片段看得懂就别 read；read 一次基本够，别反复抓。返回里会给出命中总量，" +
      "命中过多时加限定词，命中为 0 时换词。",
    parameters: Type.Object({
      mode: Type.Optional(
        Type.String({ description: "scan=粗筛返回多个片段（默认）；read=展开 scan 选中的那一条" }),
      ),
      words: Type.Optional(
        Type.Array(Type.String(), {
          description: "scan 用：关键词，1~5 个。抓唯一性高的词（专名/事件名/决定名），不要泛词",
        }),
      ),
      hit: Type.Optional(Type.String({ description: "read 用：scan 返回的 id，形如 a3f2:128" })),
      limit: Type.Optional(Type.Number({ description: `scan 返回条数（默认 ${SCAN_LIMIT_DEFAULT}，上限 ${SCAN_LIMIT_MAX}）` })),
      width: Type.Optional(Type.Number({ description: `scan 片段前后字数（默认 ${WIDTH_DEFAULT}，上限 ${WIDTH_MAX}）` })),
      span: Type.Optional(Type.Number({ description: `read 展开的前后消息条数（默认 ${SPAN_DEFAULT}，上限 ${SPAN_MAX}）` })),
      scope: Type.Optional(Type.String({ description: "project=当前项目（默认）；all=所有项目" })),
    }),

    async execute(_toolCallId, params) {
      const mode = String(params.mode || "scan").toLowerCase() === "read" ? "read" : "scan";
      const scope = String(params.scope || "project").toLowerCase() === "all" ? "all" : "project";
      const limit = Math.min(Math.max(Number(params.limit) || SCAN_LIMIT_DEFAULT, 1), SCAN_LIMIT_MAX);
      const width = Math.min(Math.max(Number(params.width) || WIDTH_DEFAULT, 60), WIDTH_MAX);
      const span = Math.min(Math.max(Number(params.span) ?? SPAN_DEFAULT, 0), SPAN_MAX);

      let stat = null;
      try {
        stat = refresh(projectCwd, scope);
      } catch (err) {
        return {
          content: [{ type: "text", text: `读取会话缓存失败：${String(err && err.message ? err.message : err).slice(0, 200)}` }],
          isError: true,
          details: {},
        };
      }

      if (!state.records.length) {
        return {
          content: [
            {
              type: "text",
              text: `没有可检索的会话。目录：${SESSIONS_DIR()}${existsSync(ARCHIVE_DIR()) ? " 与 " + ARCHIVE_DIR() : ""}`,
            },
          ],
          isError: true,
          details: { dirs: stat.dirs },
        };
      }

      // ── read：展开一条 ──
      if (mode === "read") {
        const rawHit = String(params.hit || "").trim();
        const m = rawHit.match(/^([0-9a-zA-Z]+)\s*[:#]\s*(\d+)$/);
        if (!m) {
          return {
            content: [{ type: "text", text: `hit 格式应为 <会话短号>:<行号>（如 a3f2:128），收到：「${rawHit.slice(0, 40)}」` }],
            isError: true,
            details: {},
          };
        }
        const [, sid, lineStr] = m;
        const line = Number(lineStr);
        const target = state.records.find((r) => r.sid === sid && r.line === line);
        if (!target) {
          return {
            content: [{ type: "text", text: `未找到 ${sid}:${line}。可能该会话已被改动，请重新 scan。` }],
            isError: true,
            details: {},
          };
        }
        const msgs = readRange(target.abs, true);
        const at = msgs.findIndex((x) => x.line === line);
        if (at < 0) {
          return {
            content: [{ type: "text", text: `第 ${line} 行已不是可读消息，请重新 scan。` }],
            isError: true,
            details: {},
          };
        }
        const lo = Math.max(0, at - span);
        const hi = Math.min(msgs.length - 1, at + span);
        const t = msgs[at];
        let out = `【${sid}:${t.line}】${t.ts} · ${t.role} · 该条共 ${t.text.length} 字\n`;
        out += "─".repeat(46) + "\n";
        out += t.text + "\n";
        if (hi > lo) {
          out += "\n── 同会话相邻消息（±" + span + "）──\n";
          for (let i = lo; i <= hi; i++) {
            if (i === at) continue;
            const x = msgs[i];
            const body = x.text.length > 600 ? x.text.slice(0, 600) + "…" : x.text;
            out += `\n[${sid}:${x.line}] ${x.ts} · ${x.role}\n${body}\n`;
          }
        }
        const note = out.length > OUT_MAX_CHARS ? "\n…（输出过长已截断）" : "";
        return {
          content: [{ type: "text", text: out.slice(0, OUT_MAX_CHARS) + note }],
          details: { mode: "read", hit: `${sid}:${line}`, chars: Math.min(out.length, OUT_MAX_CHARS) },
        };
      }

      // ── scan：粗筛 ──
      const res = scan({ words: params.words, limit, width });
      if (!res) {
        return {
          content: [{ type: "text", text: "words 不能为空 —— 请给出 1~5 个唯一性高的词（专名 / 事件名 / 决定名）。" }],
          isError: true,
          details: {},
        };
      }

      const head =
        `命中 ${res.total} 处 / ${res.sessionCount} 个会话（其中用户消息 ${res.userCount} 处），` +
        `已按相关性返回前 ${res.hits.length} 条。\n` +
        `范围：${scope === "all" ? "所有项目" : "当前项目"} · ${stat.dirs} 个归档目录 · ${stat.msgs} 条消息` +
        (stat.extracted ? `（本次新增抽取 ${stat.extracted} 个会话）` : "") +
        `\n排序：覆盖词数 → 用户消息优先 → 时间近\n`;

      if (!res.hits.length) {
        return {
          content: [
            {
              type: "text",
              text:
                head +
                `\n没有命中。建议换个说法再试 —— 同一件事在不同时期可能叫别的名字` +
                `（例：现在说「选品」，当时写的是「类目进入判断 / 货源密度分析」）。`,
            },
          ],
          details: { mode: "scan", words: res.words, total: 0 },
        };
      }

      const lines = [head];
      res.hits.forEach((h, i) => {
        const snip = makeSnippet(h.r.text, h.idx, h.word.length, res.width);
        lines.push(
          `\n[${i + 1}] ${h.r.sid}:${h.r.line}  ${h.r.ts} · ${h.r.role}  ` +
            `(覆盖 ${h.cov}/${res.words.length} 词，命中「${h.word}」)\n    ${snip}`,
        );
      });
      lines.push(
        `\n要看完整内容：把上面某个 id 传回来（mode=read，hit="a3f2:128"）。` +
          `命中过多就加限定词重抓，都为 0 就换词。`,
      );
      const text = lines.join("");
      return {
        content: [{ type: "text", text: text.slice(0, OUT_MAX_CHARS) }],
        details: {
          mode: "scan",
          words: res.words,
          total: res.total,
          sessionCount: res.sessionCount,
          returned: res.hits.length,
          scope,
        },
      };
    },
  });
}
