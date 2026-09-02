# AGENTS.md

本文件为在此仓库工作的 AI 代理（agent）提供约定与指南。

## 核心原则

1. **中文回复与文档**：所有回复、代码注释、提交信息、文档均使用中文撰写。
2. **修改最小化**：只做完成任务所需的修改，不重构、不顺手美化、不引入无关改动；每次改动前先理解现有代码与约定。

## 项目简介

dsh-smooth-scroll：DSH（DeepSeek Harness）平滑滚底插件。会话装载与"回到最新"瞬时钉底，流式内容以恒速平滑跟随（缓启动/软尾）。无 transform、不扰动输入栏等 UI、不干扰 DSH 自身跟随状态机，`prefers-reduced-motion` 时自动回退官方行为。

## 目录结构

- `src/client.js` — 浏览器半部（核心逻辑，全部在此文件）
- `src/index.ts` — 宿主半部（空 apply，仅为组合可见）
- `lib/` — 构建产物，**随仓库提交**（克隆即可安装使用），由 `scripts/build.mjs` 从 `src/` 规范生成
- `scripts/build.mjs` — 构建脚本
- `test/smoke.test.mjs` — 冒烟测试（`__ModuleLoader__` 契约 + apply 导出）

## 常用命令

```sh
pnpm install     # 安装 esbuild devDependency
pnpm run build   # 产出 lib/index.js + lib/client.js
pnpm test        # 冒烟测试
```

## 修改约定

- 改 `src/` 后必须重新构建（`pnpm run build`），保持 `lib/` 与 `src/` 同步。
- 参数常量位于 `src/client.js` 顶部（VEL / RAMP_MS / QUIET_MS / TAIL_PX / TAIL_MS），改参数只动常量区。
- 不修改 `node_modules/`、`cordis.patch.yml`（除非任务明确要求）。
- 涉及 DSH 适配版本（npm 0.1.1-rc.2 一代 vs GitHub 开发版 0.1.2-alpha.1 ~ alpha.5 一代）时，注意区分，勿混用；多版本兼容矩阵与验证方式见 README.md 的「兼容性」节。
