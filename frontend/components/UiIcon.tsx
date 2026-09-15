"use client";

// 图标全部来自 Lucide（https://lucide.dev，ISC 许可）—— 24×24 网格、2px stroke 设计。
// 存的是官方 SVG 的**内层标记原样**（path/rect/circle 都保留），不做二次加工：
// 换图标就去官网复制那段标记，直接替换。不装 lucide-react —— 5 个图标抄标记比多一个包划算。
export const UI_ICONS: Record<string, string> = {
  // lucide: file-text
  files:
    '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/>' +
    '<path d="M14 2v5a1 1 0 0 0 1 1h5"/>' +
    '<path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  // lucide: workflow
  canvas:
    '<rect width="8" height="8" x="3" y="3" rx="2"/>' +
    '<path d="M7 11v4a2 2 0 0 0 2 2h4"/>' +
    '<rect width="8" height="8" x="13" y="13" rx="2"/>',
  // lucide: layout-grid
  templates:
    '<rect width="7" height="7" x="3" y="3" rx="1"/>' +
    '<rect width="7" height="7" x="14" y="3" rx="1"/>' +
    '<rect width="7" height="7" x="14" y="14" rx="1"/>' +
    '<rect width="7" height="7" x="3" y="14" rx="1"/>',
  // lucide: sparkles
  skills:
    '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>' +
    '<path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
  // lucide: plug
  api:
    '<path d="M12 22v-5"/><path d="M15 8V2"/>' +
    '<path d="M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z"/>' +
    '<path d="M9 8V2"/>',
};

export function UiIcon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: UI_ICONS[name] || '<path d="M4 4h16v16H4z"/>' }}
    />
  );
}

/** 图标按钮：只有图标（无文字），全称走 tooltip；右上角可选数字角标；active 走白色渐变高亮。
 *  尺寸定稿：图标 18px（配 macOS 12px 红黄绿点；20px 会大近七成显得压，16px 又偏小）。
 *  盒子跟图标联动：boxW = icon + 14、boxH = icon + 12 —— 差值固定，所以按钮之间的视觉间距不随尺寸变。
 *  调尺寸用 icon-size-demo.html（带滑块，能对着真实三点比）。 */
export function IconButton({
  icon, title, active, badge, onClick, size = 18, boxW = 32, boxH = 30,
}: {
  icon: string;
  title: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
  size?: number;
  boxW?: number;
  boxH?: number;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        position: "relative", width: boxW, height: boxH, padding: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "transparent", border: "none", borderRadius: 8, cursor: "pointer",
        // 非激活态颜色：原来是 #9a9aa8（偏灰紫，白度不够），改成接近纯白的冷调
        color: active ? "#fff" : "#e9e9f0",
        ...(active ? { background: "linear-gradient(90deg, rgba(255,255,255,0.28), rgba(255,255,255,0.08) 70%, transparent)" } : {}),
      }}
    >
      <UiIcon name={icon} size={size} />
      {badge !== undefined && badge > 0 && (
        <span
          style={{
            position: "absolute", top: 1, right: 1, fontSize: 8, lineHeight: 1,
            padding: "1px 3px", borderRadius: 6, background: "#2a2a34", color: "#d8d8e2",
            fontFamily: "var(--font-mono)", pointerEvents: "none",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
