# 项目规则

## 约束
**单一事实源**：backend 唯一源在根 `backend/`；`electron/backend`、`electron/dist` 是 `npm run build:app`（在 `electron/` 下执行）生成的构建产物，**禁止手工修改/打补丁**。改完根 backend 后必须重新构建，产物才作数。
