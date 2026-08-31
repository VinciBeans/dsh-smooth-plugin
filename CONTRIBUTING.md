# Contributing

## 构建与测试

```sh
pnpm install        # 安装 esbuild devDependency
pnpm run build      # 产出 lib/index.js + lib/client.js
pnpm test           # 冒烟测试：__ModuleLoader__ 契约 + apply 导出
pnpm test:e2e       # 浏览器回归测试：真实 Chromium + DSH 宿主状态机复刻
```

`test:e2e` 需要本地存在 deepseek-harness 检出的 apps/web Playwright 与
Chromium（脚本通过 `%LOCALAPPDATA%/ms-playwright` 解析可执行文件），未接入 CI。

`lib/` 随仓库提交，克隆即可安装使用；改 `src/` 后重新构建。构建产物由
`scripts/build.mjs` 从 `src/` 规范生成。

## 源码

- `src/client.js` — 浏览器半部（核心逻辑）
- `src/index.ts` — 宿主半部（空 apply，仅为组合可见）

## 原理简述

直接在原生 `scrollTop` 上做有节奏的平滑滚动，配合合成 getter：平滑期间 `scrollTop`
读到目标值，DSH 的状态机（movedByReader/atBottom）看不到中间位置，避免误判脱钩或重复钉底。
