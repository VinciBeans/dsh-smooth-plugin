<div align="center">

# dsh-smooth-scroll

**让 DSH 会话滚底从瞬时跳变变成恒速平滑跟随**

装上后，流式内容增长时消息列平滑跟随到底部，回到最新仍保持瞬时。

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-smooth-scroll">
    <img src="https://img.shields.io/npm/v/dsh-smooth-scroll/alpha?style=flat&colorA=000000&colorB=000000" />
  </a>
  <a href="https://github.com/VinciBeans/dsh-smooth-plugin/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/VinciBeans/dsh-smooth-plugin?style=flat&colorA=000000&colorB=000000" />
  </a>
</p>

</div>

## Install

从 npm 安装（`alpha` dist-tag 指向 0.1.2-alpha.3，适配 dsh v0.1.2-alpha.1 ~ alpha.3）：

```sh
dsh plugin --profile web add dsh-smooth-scroll@alpha
```

需要已安装 DSH，并至少成功启动过一次 Web GUI。

npm `latest`（0.1.1-rc.2）仍是旧 client-runtime 代，仅适配 dsh 0.1.1-rc.2；安装它的命令为 `dsh plugin --profile web add dsh-smooth-scroll`。源码安装：`dsh plugin --profile web add .`。

## Quickstart

```sh
dsh plugin --profile web add dsh-smooth-scroll@alpha
dsh --profile web --dump-config          # 看到 dsh-smooth-scroll 层即安装成功
# 重启 dsh web，打开会话，流式内容平滑滚到底部
```

## 滚动行为

直接在原生 `scrollTop` 上做有节奏的平滑滚动，配合合成 getter：平滑期间 `scrollTop` 读到目标值，DSH 自身状态机看不到中间位置，不误判脱钩、不重复钉底。

- **速度剖面:** 起步 0 到 0.9px/ms 用 240ms 缓升，巡航恒速 0.9px/ms，收尾 220ms 软着陆。
- **用户滚动接管:** 真实位置连续偏离动画写入 ≥2 帧才停动画，DSH 正常脱钩，回到最新按钮照常；单帧偏差（浏览器滚动锚定等一次性非用户位移）自动重基后继续钉底跟随——发送消息等操作引发的非用户位移不会导致误判脱钩或停在信息处；内容收窄导致的夹紧则在 2 帧内停止于新底部（同样不掉队）。与之对称，孤立的一次性小幅定位（如滚动条点一格）也会被当作非用户位移吸收、随后被跟随回底部；只有持续 ≥2 帧的偏离才视为用户接管。另：主机内（输入栏除外）的**指针按下立即停动画**并让 getter 回落真实值——alpha.3 的 turn 导轨跳转（`landOnRow` 复合读改写）由此读到真实位置，落点不被合成目标偏移。
- **同目标兜底:** DSH 每滚动事件重跑 toBottom 而目标不变时忽略，动画不被逐帧重启。
- **减少动效:** prefers-reduced-motion 时完全回退官方瞬时行为。
- **无 transform:** 不应用任何 transform，输入栏 overlay/sticky 永不受扰。

## 参数

| 常量 | 默认 | 含义 |
| --- | --- | --- |
| VEL | 0.9 | 巡航速度（px/ms） |
| RAMP_MS | 240 | 起步缓加速时长 |
| QUIET_MS | 240 | 判定停止增长的静默窗口 |
| TAIL_PX | 120 | 进入软尾的剩余距离阈值 |
| TAIL_MS | 220 | 软尾缓动时长 |
| DIVERGE_STOP_FRAMES | 2 | 真实位置连续偏离动画写入的帧数阈值（≥2 帧判定读者接管） |

改参数：编辑 `src/client.js` 顶部常量区，`pnpm run build` 后重启 dsh web。

## 兼容性

- **dsh v0.1.2-alpha.1 ~ alpha.3（支持）:** 插件的唯一 DOM 锚点 `[data-conversation-scroll]`（会话滚动容器）与宿主跟随状态机（`observedTopRef` / `movedByReader` / ResizeObserver follow、`el.scrollTop` 读写面）在 `dsh-v0.1.2-alpha.1`、`dsh-v0.1.2-alpha.2`、`dsh-v0.1.2-alpha.3` 三个 tag 上一致——alpha.3 只在滚动容器外多包了一层 `.body`，属性与滚动语义未变。alpha.3 新增的 turn 导轨跳转（`landOnRow` 的 `el.scrollTop += flowTop - 24` 复合读改写）遇到插件追击时会被 pointerdown 接管先停动画，复合写读到真实位置，落点不被合成 getter 偏移；该接管在三个版本上同样生效。
- **0.1.1-rc.2 及更早（不支持）:** 该代使用 `@deepseek-ai/dsh-client-runtime`，滚动宿主结构不同，不兼容。
- 验证：`pnpm test`（契约冒烟，bundle 自包含）+ `node test/scroll-follow.test.mjs`（15 个 e2e 场景，含「追击中点击导轨」回归点；需 Playwright 与 Chromium）。

## License

MIT
