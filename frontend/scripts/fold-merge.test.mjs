// renderTurns 段式折叠算法的可运行检查（与 page.tsx 的 isFolded/foldBuf + segFirstUser/segLastAsst 一一对应）
// 场景：用户看到的序列 [3步, 0步, 2步, 11步] —— 0 步回合不打断合并，输出一个 16 个步骤的头
// 段结构：[段内第一个 user 提问] + [16 个步骤折叠头] + [段内最后一个 assistant 正文]
import assert from "node:assert";

const mkTurn = (turnId, stepCount, { userText = null, asstText = `回合${turnId}总结` } = {}) => {
  const turn = [];
  if (userText) turn.push({ role: "user", turnId, text: userText });
  for (let i = 0; i < stepCount; i++) turn.push({ role: "activity", turnId });
  turn.push({ role: "assistant", turnId, text: asstText });
  return turn;
};
const stepCountOf = (turn) => turn.filter((e) => e.role === "activity" || e.thinking).length;
// 与 page.tsx isFolded 相同：已结束（busy=false）+ 未展开
const currentTurnId = 4;
const isFolded = (turn, openTurns, busy = false) => {
  const turnId = turn[0]?.turnId;
  if (turnId === undefined) return false;
  const running = busy && turn.some((e) => e.status === "running");
  return !running && !openTurns.has(turnId) && (turnId < currentTurnId || !busy);
};

// 段 = 连续已结束回合（3 步提问1 / 0 步插话 / 2 步 / 11 步），其中第 2 个回合是中途插话（无 user 提问）
const turns = [
  mkTurn(1, 3, { userText: "帮我研究选品", asstText: "回复A" }),
  mkTurn(2, 0, { asstText: "收到" }), // 插话回合：无 user 提问
  mkTurn(3, 2, { asstText: "回复B" }),
  mkTurn(4, 11, { asstText: "回复C" }),
];
const openTurns = new Set();

// 合并：连续已结束回合累积成段
const segs = [];
let buf = null;
for (const turn of turns) {
  if (isFolded(turn, openTurns)) {
    if (!buf) buf = { turns: [], turnIds: [], sumSteps: 0 };
    buf.turns.push(turn);
    buf.turnIds.push(turn[0].turnId);
    buf.sumSteps += stepCountOf(turn);
  } else {
    if (buf) { segs.push(buf); buf = null; }
  }
}
if (buf) segs.push(buf);

assert.strictEqual(segs.length, 1, "应合并成一个段（0 步插话回合不打断）");
assert.strictEqual(segs[0].sumSteps, 16, "3+0+2+11 = 16 个步骤");
assert.deepStrictEqual(segs[0].turnIds, [1, 2, 3, 4], "段内含全部 4 个回合");

// 段渲染辅助（与 page.tsx segFirstUser/segLastAsst 相同）
const segFirstUser = (s) => { for (const t of s.turns) for (const e of t) if (e.role === "user") return e; return null; };
const segLastAsst = (s) => {
  for (let i = s.turns.length - 1; i >= 0; i--) {
    const t = s.turns[i];
    for (let j = t.length - 1; j >= 0; j--) if (t[j].role === "assistant" && t[j].text.trim()) return t[j];
  }
  return null;
};
const firstUser = segFirstUser(segs[0]);
const lastAsst = segLastAsst(segs[0]);
assert.strictEqual(firstUser?.text, "帮我研究选品", "段起点显示段内第一个 user 提问");
assert.strictEqual(lastAsst?.text, "回复C", "段终点显示模型自然结束的最后正文（中间回复A/B 折叠）");

// 点击展开全部：所有 turnId 进 openTurns → 全部展开（不再折叠）
const toggled = new Set(openTurns);
for (const tid of segs[0].turnIds) toggled.add(tid);
for (const turn of turns) assert.strictEqual(isFolded(turn, toggled), false, "展开后回合不折叠");

console.log("✓ seg-fold: [提问] + [16 个步骤] + [最后回复]，0 步插话不打断，中间回复折叠");
