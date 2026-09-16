"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { markdownRehypePlugins, markdownRemarkPlugins } from "@/lib/markdown";

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
}

// 必须在模块层定义，不能内联在 ReactMarkdown 的 components 里 ——
// 内联写法每次渲染都产生全新的函数 identity，React 会判定 element type 变了，
// 于是卸载整棵子树重新挂载：流式期间（节流后约每 80ms 一次渲染）消息里每个
// 代码块的 SyntaxHighlighter 都被销毁重建、Prism 从头重新高亮 → 主线程打满、
// DOM 反复替换 → 界面抖动。这正是「只有最终正文抖、思考块不抖」的原因：
// 思考块是 whiteSpace:pre-wrap 纯文本，根本不走这条 markdown 管线。
// 这几个 renderer 不依赖任何 props，所以放模块层是安全的。
const MARKDOWN_COMPONENTS = {
  code({ className, children, ...props }: any) {
    const lang = className?.replace("language-", "").toLowerCase() ?? "";
    const raw = String(children);
    const isBlock = className?.includes("language-") || raw.includes("\n");
    if (isBlock) {
      return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
    }
    return <code {...props}>{children}</code>;
  },
  pre({ children }: any) {
    return <>{children}</>;
  },
  p({ children }: any) {
    return <div style={{ margin: "0 0 0.35em 0" }}>{children}</div>;
  },
  a({ href, children, ...props }: any) {
    // 外链新标签打开：来源引用点击直接跳转，不导航当前会话页
    return (
      <a href={href} target="_blank" rel="noreferrer" {...props}>
        {children}
      </a>
    );
  },
};

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (!ok) throw new Error("execCommand copy failed");
    return Promise.resolve();
  } catch {
    return Promise.reject();
  }
}

function MarkdownBodyImpl({ children, className, isStreaming }: MarkdownBodyProps) {
  // ponytail: throttle streaming re-renders — avoid re-parsing markdown + syntax highlight every token
  const [throttled, setThrottled] = useState(children);
  const lastRenderRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isStreaming) {
      setThrottled(children);
      return;
    }
    const now = performance.now();
    const elapsed = now - lastRenderRef.current;
    if (elapsed >= 80) {
      lastRenderRef.current = now;
      setThrottled(children);
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        lastRenderRef.current = performance.now();
        setThrottled(children);
      });
    }
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [children, isStreaming]);

  const content = isStreaming ? throttled : children;
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(content), [content]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={MARKDOWN_COMPONENTS}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownBody = memo(MarkdownBodyImpl);

function normalizeDisplayMath(markdown: string): string {
  const lineBreak = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  let fence: { marker: string; size: number } | null = null;

  return lines
    .map((line) => {
      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        const size = fenceMatch[1].length;
        if (!fence) fence = { marker, size };
        else if (marker === fence.marker && size >= fence.size) fence = null;
        return line;
      }

      if (fence) return line;

      const displayMathMatch = line.match(/^([ \t]{0,3})\$\$(.+)\$\$[ \t]*$/);
      if (!displayMathMatch) return line;

      const math = displayMathMatch[2].trim();
      if (!math) return line;

      return `${displayMathMatch[1]}$$${lineBreak}${math}${lineBreak}${displayMathMatch[1]}$$`;
    })
    .join(lineBreak);
}

// memo：已完成的高亮块在后续流式重渲染里不必重算。SyntaxHighlighter 每次渲染都会重跑 Prism，
// 一条长回复里十几个代码块 × 每 80ms 一次渲染 = 主线程被高亮反复占用（界面发顿/发抖的二级来源）。
// props 只有 code/lang，内容不变就跳过。
const CodeBlock = memo(function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    copyText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      style={{
        position: "relative",
        marginTop: 4,
        marginBottom: 4,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "3px 10px",
          fontSize: 11,
          color: "var(--text-dim)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>{lang}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            onClick={copy}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
      </div>
      <SyntaxHighlighter
        language={lang || "text"}
        style={vscDarkPlus}
        showLineNumbers
        lineNumberStyle={{ color: "var(--text-dim)", fontStyle: "normal" }}
        customStyle={{
          margin: 0,
          padding: "10px 12px",
          fontSize: 12.5,
          lineHeight: 1.6,
          borderRadius: 12,
          background: "transparent",
        }}
        codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
});
