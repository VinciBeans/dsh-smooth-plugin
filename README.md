# dsh-smooth-scroll

> 兼容目标：**dsh-0.1.2-alpha.1**。插件不依赖任何 `@deepseek-ai/dsh-client-*` 运行时包
> （仅使用 Cordis 核心 `ctx.effect` 与浏览器原生 API），`window.__ModuleLoader__.load`
> 模块契约与 `dsh.client.platform: web` 声明在 0.1.2-alpha.1 中保持不变，因此无需改动
> 运行时逻辑即可适配。

## 简介

让 DSH 的会话滚底从"官方瞬时跳变"变成**流畅顺滑的跟随滚动**：会话装载与"回到最新"
保持瞬时（这是"跳"的正确语义），而流式内容增长期间，消息列以**恒定速度平滑跟随**，
起步轻柔、收尾绵软。系统开启"减少动效"（`prefers-reduced-motion`）时自动回退官方瞬时行为。

## 行为（无 transform）

直接在**原生 scrollTop** 上做有节奏的平滑滚动，配合**合成 getter**：平滑期间
`scrollTop` 读到"目标值"，DSH 自身的状态机（movedByReader/atBottom）永远看不到中间
位置——不会误判脱钩、不会重复钉底。

- **速度剖面（velocity chase + 缓启动 + 软尾）**
  - 起步：0 → 0.9px/ms，240ms smoothstep 爬升；
  - 巡航：恒速 0.9px/ms（内容增长只更新目标点，曲线永不逐段重启）；
  - 收尾：停止增长 >240ms 且剩余 ≤120px 时，220ms ease-out 软着陆；
- **同目标兜底写入**（DSH 每滚动事件重跑 `toBottom`，目标不变）→ 忽略，动画不被逐帧重启；
- **用户滚动接管**：真实位置偏离动画自身写入（唯一只能来自用户）→ 立即停动画、
  getter 恢复真实、DSH 正常脱钩（"回到最新"按钮照常）；
- `prefers-reduced-motion: reduce`：完全回退官方瞬时行为；
- **不应用任何 transform**：输入栏 overlay/sticky 永不受扰（无瞬移、无毛边、无飞出）。

## 构建与测试

```sh
pnpm install        # 安装 esbuild devDependency
pnpm run build      # 产出 lib/index.js + lib/client.js
pnpm test           # 冒烟测试：验证 __ModuleLoader__ 模块契约 + apply 导出
```

`lib/` 已随仓库提交，克隆后可直接安装使用；改源码才需要重新构建。构建产物由
`scripts/build.mjs` 从 `src/` 规范生成。

## 安装（永久生效）

```sh
bash install-real-profile.sh    # Windows 用 Git Bash / WSL；Linux/macOS 直接 bash
```

脚本执行：`pnpm add link:<本目录>`（~/.dsh/profiles/web/package.json）+ 向
`cordis.patch.yml` 追加 `- insert: [{ id: smooth-scroll, name: 'dsh-smooth-scroll' }]`。
然后**重启 dsh web**。注意：源目录为 link 安装，改 `src/client.js` 后重建即可热更到下次启动。

## 卸载

删除 `cordis.patch.yml` 对应 insert 块 + `pnpm remove dsh-smooth-scroll`，重启。

## 调参

所有参数都在 `src/client.js` 顶部常量区：

| 常量 | 默认 | 含义 |
|---|---|---|
| `VEL` | 0.9 | 巡航速度（px/ms） |
| `RAMP_MS` | 240 | 起步缓加速时长（smoothstep） |
| `QUIET_MS` | 240 | 判定"停止增长"的静默窗口 |
| `TAIL_PX` | 120 | 进入软尾的剩余距离阈值 |
| `TAIL_MS` | 220 | 软尾缓动时长 |

改完：`pnpm run build` → 重启 dsh web。

## 源码

- `src/client.js` — 浏览器半部（核心逻辑）
- `src/index.ts` — 宿主半部（空 apply，仅为组合可见）
