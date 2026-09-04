"use client";

// 12 类节点单色线框图标（SVG stroke，无填充）
const ICONS: Record<string, string> = {
  // 放大镜
  "Fetch/Gather": "M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z",
  // 对齐栅格
  Standardize: "M4 6h16M4 12h16M4 18h16M8 6v12M16 6v12",
  // 分叉
  "Classify/Route": "M5 5h6a4 4 0 0 1 0 8H5M5 13h6a4 4 0 0 1 4 4v2M5 5v8M5 9h3",
  // 对勾圈
  "Extract/Validate": "M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20zm-5-9l3 3 6-7",
  // 笔
  "Generate/Draft": "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
  // 转换箭头
  "Transform/Produce": "M4 4v7h7M20 20v-7h-7M20 4l-8 8-4-4",
  // 折线分析
  "Analyze/Judge": "M3 3v18h18M7 14l4-5 3 3 5-7",
  // 靶心
  "Strategize/Plan": "M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20zm0-6a4 4 0 1 1 0-8 4 4 0 0 1 0 8zM12 12h.01",
  // 发送
  "Writeback/Action": "M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z",
  // 盾牌
  "Review/Gate": "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  // 盒子
  "Artifact/Render": "M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8",
  // 铃铛
  "Monitor/Alert": "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
};

export function NodeIcon({ type, size = 20 }: { type: string; size?: number }) {
  const d = ICONS[type] || "M4 4h16v16H4z";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d={d} />
    </svg>
  );
}
