<div align="center">

# dsh-smooth-scroll

**让 DSH 会话滚底从瞬时跳变变成恒速平滑跟随**

装上后，流式内容增长时消息列平滑跟随到底部，回到最新仍保持瞬时。

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-smooth-scroll">
    <img src="https://img.shields.io/npm/v/dsh-smooth-scroll?style=flat&colorA=000000&colorB=000000" />
  </a>
  <a href="https://github.com/VinciBeans/dsh-smooth-plugin/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/VinciBeans/dsh-smooth-plugin?style=flat&colorA=000000&colorB=000000" />
  </a>
</p>

</div>

## Install

```sh
dsh plugin --profile web add dsh-smooth-scroll
```

需要已安装 DSH，并至少成功启动过一次 Web GUI。

## Quickstart

```sh
dsh plugin --profile web add dsh-smooth-scroll
dsh --profile web --dump-config          # 看到 dsh-smooth-scroll 层即安装成功
# 重启 dsh web，打开会话，流式内容平滑滚到底部
```

## 滚动行为

直接在原生 `scrollTop` 上做有节奏的平滑滚动，配合合成 getter：平滑期间 `scrollTop` 读到目标值，DSH 自身状态机看不到中间位置，不误判脱钩、不重复钉底。

- **速度剖面:** 起步 0 到 0.9px/ms 用 240ms 缓升，巡航恒速 0.9px/ms，收尾 220ms 软着陆。
- **用户滚动接管:** 真实位置连续偏离动画写入 ≥2 帧才停动画，DSH 正常脱钩，回到最新按钮照常；单帧偏差（浏览器滚动锚定、尺寸夹紧等一次性非用户位移）自动重基后继续钉底跟随——发送消息后不再因误判停在信息处。与之对称，孤立的一次性小幅定位（如滚动条点一格）也会被当作非用户位移吸收、随后被跟随回底部；只有持续 ≥2 帧的偏离才视为用户接管。
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

- **npm 正式版 0.1.1-rc.2:** 适配 npm 上的 dsh 0.1.1-rc.2（client-runtime 一代）。
- **开发版 0.1.2-alpha.1:** main 分支，适配 dsh GitHub 最新版（cordis-Context 一代）。

## License

MIT
