"use client";

// 自定义 API 端点逐步引导：一步一问，回车下一步，全程 BorderGlow 光晕（与主对话输入框同款参数）
// 保存走后端 set_custom_provider：写 ~/.pi/agent/models.json，未显式 MAIN_MODEL 时切为主模型
import { useState } from "react";
import { BorderGlow } from "./BorderGlow";

const STEPS = [
  { status: "第 1 步 / 共 3 步", ask: "请输入请求地址（Base URL）", ph: "https://api.example.com/v1", key: "baseUrl" as const },
  { status: "第 2 步 / 共 3 步", ask: "请输入 API Key", ph: "sk-...", key: "apiKey" as const },
  { status: "第 3 步 / 共 3 步", ask: "请输入模型 ID", ph: "gpt-4o-mini / deepseek-chat / ...", key: "modelId" as const },
];

export function CustomEndpointGuide({
  onSetCustomProvider,
  onClose,
}: {
  onSetCustomProvider: (baseUrl: string, apiKey: string, modelId: string) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [value, setValue] = useState("");
  const [data, setData] = useState({ baseUrl: "", apiKey: "", modelId: "" });
  const [done, setDone] = useState(false);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    const next = { ...data, [STEPS[step].key]: v };
    setData(next);
    setValue("");
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      onSetCustomProvider(next.baseUrl, next.apiKey, next.modelId);
      setDone(true);
    }
  };

  const glowProps = {
    edgeSensitivity: 20,
    backgroundColor: "#000",
    borderRadius: 34,
    glowRadius: 45,
    coneSpread: 29,
    fillOpacity: 0.5,
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
      }}
      onClick={onClose}
    >
      {/* 整个弹窗 BorderGlow（圆角 18） */}
      <BorderGlow
        edgeSensitivity={20}
        backgroundColor="#242424"
        borderRadius={18}
        glowRadius={45}
        coneSpread={29}
        fillOpacity={0.5}
        style={{ width: "min(760px, calc(100vw - 36px))", height: "min(74vh, 720px)", borderRadius: 18 }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ height: "100%", display: "grid", gridTemplateRows: "1fr auto", color: "var(--text)" }}
        >
          <section style={{ overflow: "auto", padding: "12vh 26px 0", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 18 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.08 }}>自定义 API 端点</div>
              <div style={{ fontSize: 11, fontWeight: 750, color: "var(--text-muted)", marginTop: 4 }}>
                {done ? "配置完成" : STEPS[step].status}
              </div>
            </div>

            {done ? (
              <div style={{ display: "grid", gap: 8, justifyItems: "center" }}>
                <div style={{ fontSize: 40, lineHeight: 1, color: "var(--status-success)" }}>✓</div>
                <div style={{ maxWidth: "min(620px, 94%)", fontSize: 17, fontWeight: 650, lineHeight: 1.65 }}>
                  已写入 {data.baseUrl}
                  <br />
                  主模型切换为 <b>{data.modelId}</b>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-dim)" }}>~/.pi/agent/models.json</div>
              </div>
            ) : (
              <>
                <div style={{ maxWidth: "min(620px, 94%)", fontSize: 17, fontWeight: 650, lineHeight: 1.65 }}>
                  {STEPS[step].ask}
                </div>
                {/* 输入框：BorderGlow 胶囊，无边框线框（与主对话输入框同款） */}
                <div style={{ width: "min(560px, 94%)", marginTop: 44 /* 与提问文字隔两行空行 */ }}>
                  <BorderGlow {...glowProps} style={{ flex: 1, borderRadius: 34 }}>
                    <textarea
                      autoFocus
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          submit();
                        }
                      }}
                      placeholder={STEPS[step].ph}
                      rows={1}
                      style={{
                        flex: 1, background: "transparent", color: "#e8e8e8",
                        border: "none", borderRadius: 32,
                        padding: "16px 26px", fontSize: 17, outline: "none", resize: "none",
                        minHeight: 64, lineHeight: 1.5, fontFamily: "inherit", textAlign: "center",
                        width: "100%",
                      }}
                    />
                  </BorderGlow>
                </div>
              </>
            )}
          </section>

          <footer style={{ padding: "8px 24px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <button
              onClick={() => (done ? onClose() : setStep((s) => s - 1))}
              style={{
                height: 42, border: "none", background: "transparent",
                color: "var(--text-dim)", padding: "0 10px", fontSize: 12,
                fontWeight: 800, cursor: "pointer", visibility: done || step === 0 ? "hidden" : "visible",
              }}
            >
              ← 上一步
            </button>
            {done && (
              <button
                onClick={onClose}
                style={{
                  height: 42, border: "none", borderRadius: 8, background: "var(--accent)",
                  color: "#0b0f14", padding: "0 24px", fontSize: 13, fontWeight: 750, cursor: "pointer",
                }}
              >
                完成
              </button>
            )}
          </footer>
        </div>
      </BorderGlow>
    </div>
  );
}
