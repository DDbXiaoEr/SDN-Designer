# AGENTS

本文件是 OVN-Designer 项目的 AI 助手工作指南。

## 会话开始

- **先阅读 [`PROJECT_STRUCTURE.md`](./PROJECT_STRUCTURE.md)**，其中包含目录结构、数据模型与关键约定，避免每次会话都重新探索整个项目。
- 需要了解具体实现时，再按需打开对应源文件。

## 常用命令

```bash
npm install        # 安装依赖
npm run dev        # 启动开发服务器 (http://localhost:5173/)
npm run build      # 生产构建（修改后务必运行验证）
npm run preview    # 预览生产构建
```

## 编码约定

- Vue 3 组合式 API + `<script setup>`；保持现有代码风格与命名。
- **不要添加任何注释**，除非用户明确要求。
- **不要主动提交代码**，仅在用户明确要求时提交。
- 新增节点类型 → 在 `src/data/nodeDefinitions.js` 添加 `NODE_TYPES` 记录 + `CONNECTION_RULES` + 双语 i18n 文案。
- 所有 UI 文案走 vue-i18n（`useI18n().t` / `translate()`），同时更新 `zh-CN.js` 与 `en-US.js`。
- 节点/边状态通过 `createDesigner()` / `useDesigner()` 管理（见 PROJECT_STRUCTURE.md 约定），勿用 `v-model:nodes`。
- 修改后运行 `npm run build` 确认无编译错误。

## 验证

- 导出逻辑为纯函数，可直接用 `node` 导入 `src/export/*.js` 做单元验证。
- 交互流程可用浏览器（Playwright）验证：拖拽节点、连线、属性编辑、导出弹窗。
