// inspect_file 工具：本地数据文件 → 定向文本（XLSX/CSV/PDF/HTML）
// 设计（2026-08-27 讨论）：1688/供应商导出表、榜单、数据站导出 → 定向提取字段；
// 与 read_page 同属"取数补漏"族；一次一个意图，输出前 N 行/页，不全文 dump。
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { ROUTER_MENU, LOC } from "./routing.js";

const PY = "/usr/bin/python3";

const HELPER = `
import sys, csv
p = sys.argv[1]
mode = sys.argv[2]
max_rows = int(sys.argv[3])
sheet = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else None
if mode == 'xlsx':
    import openpyxl
    wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
    ws = wb[sheet] if (sheet and sheet in wb.sheetnames) else wb.active
    rows = []
    for i, r in enumerate(ws.iter_rows(values_only=True)):
        if i >= max_rows: break
        rows.append("\\t".join("" if c is None else str(c) for c in r))
    print(f"shet_total={wb.active.max_row} | rows_shown={len(rows)}")
    for r in rows: print(r)
elif mode == 'csv':
    with open(p, newline='', encoding='utf-8', errors='replace') as f:
        rd = list(csv.reader(f))
    print(f"csv_total_rows={len(rd)} | rows_shown={min(max_rows,len(rd))}")
    for r in rd[:max_rows]: print(", ".join("" if c is None else c for c in r))
elif mode == 'pdf':
    from pypdf import PdfReader
    r = PdfReader(p)
    print(f"pdf_pages={len(r.pages)} | pages_shown={min(max_rows,len(r.pages))}")
    for pg in r.pages[:max_rows]:
        t = (pg.extract_text() or "").strip()
        if t: print(t)
elif mode == 'html':
    import re
    t = open(p, encoding='utf-8', errors='replace').read()
    t = re.sub(r'<(script|style)[^>]*>.*?</\\1>', ' ', t, flags=re.S|re.I)
    t = re.sub(r'<[^>]+>', ' ', t)
    t = re.sub(r'\\s+', ' ', t).strip()
    print(f"html_chars={len(t)}")
    print(t[:20000])
else:
    sys.exit("unsupported")
`;

const MODES = { xlsx: "xlsx", xls: "xlsx", csv: "csv", pdf: "pdf", htm: "html", html: "html", txt: "txt" };

export const inspectFileTool = defineTool({
  name: "inspect_file",
  label: "查看本地数据文件",
  description:
    ROUTER_MENU + "\n" +
    LOC.inspectFile +
    "\n\n用法：path 必填（xlsx/csv/pdf/html/txt）；sheet=xlsx 指定工作表；max_rows=显示行数或 pdf 页数（默认 50）；extract=要定向提取的字段说明。输出为前 N 行/页文本，取完即定向提取，不全文回显。",
  parameters: Type.Object({
    path: Type.String({ description: "本地文件路径（相对当前 cwd 或绝对路径）" }),
    sheet: Type.Optional(Type.String({ description: "xlsx 工作表名（默认第一个表）" })),
    max_rows: Type.Optional(Type.Number({ description: "显示行数/页数上限（默认 50，xlsx/csv 最多 500）" })),
    extract: Type.Optional(Type.String({ description: "要定向提取的字段（如：价格列、销量、日期范围）" })),
  }),
  async execute(_toolCallId, params) {
    const p = String(params.path ?? "").trim();
    if (!p) return { content: [{ type: "text", text: "path 不能为空。" }], isError: true, details: {} };
    if (!existsSync(p)) return { content: [{ type: "text", text: `文件不存在：${p}` }], isError: true, details: {} };
    if (statSync(p).size > 200 * 1024 * 1024) return { content: [{ type: "text", text: "文件超过 200MB，拒绝读取。" }], isError: true, details: {} };
    const ext = (p.split(".").pop() || "").toLowerCase();
    const mode = MODES[ext];
    if (!mode || mode === "txt") {
      if (mode === "txt") {
        const t = execFileSync(PY, ["-c", "import sys;print(open(sys.argv[1],encoding='utf-8',errors='replace').read()[:8000])", p], { encoding: "utf-8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
        return { content: [{ type: "text", text: `【${p}】\n${t}` }], details: { via: "txt" } };
      }
      return { content: [{ type: "text", text: `不支持的文件类型：.${ext}（支持 xlsx/csv/pdf/html/txt）` }], isError: true, details: {} };
    }
    const maxRows = Math.min(Math.max(Number(params.max_rows) || 50, 1), mode === "pdf" ? 20 : 500);
    try {
      const out = execFileSync(PY, ["-c", HELPER, p, mode, String(maxRows), params.sheet ?? ""], {
        encoding: "utf-8", timeout: 60000, maxBuffer: 16 * 1024 * 1024,
      });
      const focus = params.extract ? `【目标字段】${params.extract}\n` : "";
      const body = out.length > 10000 ? `${out.slice(0, 10000)}\n…（截断）` : out;
      return { content: [{ type: "text", text: `${focus}${body}` }], details: { via: mode, maxRows } };
    } catch (e) {
      return { content: [{ type: "text", text: `解析失败：${String(e?.stderr || e?.message || e).slice(0, 500)}` }], isError: true, details: {} };
    }
  },
});
