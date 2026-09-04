// Artifact 判定（唯一事实来源，server 主会话监听 + worker 节点收集共用）
// 原则：Artifact = 交付物（写给用户看/用的最终产物），不是达成目的的手段（过程文件）
import path from "node:path";

// 交付白名单：文档交付物 + 图片；.py/.csv/.json 等脚本与中间数据一律不收
// 导出给 server 的 CWD watcher 做粗滤（避免 node_modules 等写入风暴全量进去抖队列）
export const EXT_WHITELIST = ["md", "markdown", "doc", "docx", "pdf", "html", "png", "jpg", "jpeg", "gif", "svg", "webp"];
// 产出型节点：声明了"这一步产交付物"；Strategize/Plan（内部计划）、Standardize/Analyze 等过程节点不收
const DELIVERABLE_NODE_TYPES = ["Generate/Draft", "Transform/Produce", "Artifact/Render"];

export function isArtifact(rawPath, { cwd, nodeType, allowOutsideCwd } = {}) {
  if (!rawPath) return false;
  const root = path.resolve(cwd ?? process.cwd());
  const abs = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(root, rawPath);
  const rel = path.relative(root, abs);
  // 1. 路径必须落在项目 CWD 内（write 工具产物豁免：模型可能写到实际工作区而非会话 cwd，
  //    如 FLY 打包目录 cwd 下模型把交付物写到真实项目里——artifact 不该因此丢）
  if (!allowOutsideCwd && (rel.startsWith("..") || path.isAbsolute(rel))) return false;
  // 2. 排除隐藏文件/目录与依赖目录（按绝对路径段，兼容 cwd 外路径）
  const segs = abs.split(path.sep);
  if (segs.some((p) => p.startsWith("."))) return false;
  if (segs.includes("node_modules")) return false;
  // 2. 扩展名白名单
  const ext = path.extname(abs).toLowerCase().slice(1);
  if (!EXT_WHITELIST.includes(ext)) return false;
  // 3. worker 节点：必须是产出型节点（主会话无 nodeType，白名单即终判）
  if (nodeType && !DELIVERABLE_NODE_TYPES.includes(nodeType)) return false;
  return true;
}
