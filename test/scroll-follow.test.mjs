/**
 * 端到端回归测试：真实 Chromium 中验证 dsh-smooth-scroll 的钉底跟随。
 *
 * 页面复刻 DSH 宿主的几何与跟随状态机（ChatView 的 toBottom /
 * observedTopRef 账本 / movedByReader·isAtBottom 滚动处理 / ResizeObserver
 * 跟随），并加载构建产物 lib/client.js。随后运行发送、流式、浏览器锚定位移、
 * 真实读者拖拽等交错场景，断言宿主是否仍钉底、最终距离是否为 0。
 *
 * 回归点（曾出问题的场景）：
 *   - anchorShiftMidChase / anchorShiftMidTail：追击中途上方行塌陷触发
 *     浏览器滚动锚定，旧实现误判为读者接管 → 判定脱钩 → 发送后停在信息处；
 *     修复后必须继续跟随到底。
 *   - takeoverMidChase：真实读者持续拖拽必须停止动画并正常脱钩。
 *
 * 运行：  node test/scroll-follow.test.mjs
 * 需要 deepseek-harness 检出的 apps/web Playwright 与其 Chromium。
 */
import { createRequire } from 'node:module'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = (() => {
  try {
    return require('E:/Works/deepseek-harness/apps/web/node_modules/playwright')
  } catch {
    return {}
  }
})() ?? {}

if (chromium === undefined) {
  console.error('缺少 Playwright：请安装 deepseek-harness 检出的 apps/web devDependencies，或调整下方路径。')
  process.exit(2)
}
const PLUGIN_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url))

/** 在 %LOCALAPPDATA%/ms-playwright 中挑最新的 chromium_headless_shell 可执行文件。 */
function resolveChromium() {
  try {
    const dir = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
    if (!existsSync(dir)) return undefined
    const shells = readdirSync(dir)
      .filter(name => name.startsWith('chromium_headless_shell-'))
      .sort()
      .reverse()
    for (const shell of shells) {
      const exe = join(dir, shell, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')
      if (existsSync(exe)) return exe
    }
  } catch {
    /* 回退到 Playwright 自带解析 */
  }
  return undefined
}

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; }
  #scroll {
    box-sizing: border-box;
    width: 760px; height: 420px;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex; flex-direction: column;
    background: #fff;
    font: 13px/1.4 system-ui, sans-serif;
  }
  #view { flex: 1 0 auto; min-height: auto; }
  #column { display: flex; flex-direction: column; gap: 8px; padding: 8px; }
  .row { flex: none; background: #eef; border-radius: 4px; }
  .user-row { flex: none; background: #dfd; border-radius: 4px; }
  .bubble { background: #fee; border-radius: 4px; padding: 4px; white-space: pre-wrap; }
  #composerSeat { flex: none; position: sticky; bottom: 0; z-index: 7; background: #fff; }
  #composerCard { height: 52px; background: #ccc; }
  #composerSeat.tall #composerCard { height: 208px; }
</style></head>
<body>
  <div id="root">
    <div id="scroll" data-conversation-scroll="">
      <div id="view"><div id="column"></div></div>
      <div id="composerSeat" data-composer-seat=""><div id="composerCard"></div></div>
    </div>
  </div>
</body></html>
`

// 页面内脚本：DSH 宿主复刻 + 场景驱动（语义与 ChatView.tsx 逐行对应）。
const HOST_JS = `
window.host = (() => {
  const el = document.getElementById('scroll')
  const column = document.getElementById('column')
  const composer = document.getElementById('composerSeat')
  const nativeDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
  const realTop = () => nativeDesc.get.call(el)
  const FOLLOW_THRESHOLD = 24
  let observedTopRef = 0
  let atBottomRef = false
  let events = []
  const log = (entry) => events.push({ at: Math.round(performance.now()), ...entry })
  const toBottom = () => {
    el.scrollTop = el.scrollHeight
    observedTopRef = el.scrollTop
    atBottomRef = true
    log({ t: 'toBottom', getter: el.scrollTop, real: realTop(), floor: el.scrollHeight - el.clientHeight })
  }
  const onScroll = () => {
    const floor = Math.max(0, el.scrollHeight - el.clientHeight)
    const getter = el.scrollTop
    const real = realTop()
    const movedByReader = Math.abs(getter - Math.min(observedTopRef, floor)) > 0.5
    const isAtBottom = movedByReader ? floor - getter <= FOLLOW_THRESHOLD + 1 : atBottomRef
    if (!movedByReader && isAtBottom) { toBottom(); return }
    atBottomRef = isAtBottom
    observedTopRef = getter
    log({ t: 'scroll', getter, real, floor, movedByReader, isAtBottom, atBottomRef })
  }
  el.addEventListener('scroll', onScroll, { passive: true })
  const follow = () => {
    if (atBottomRef) {
      el.scrollTop = el.scrollHeight
      observedTopRef = el.scrollTop
      log({ t: 'follow', getter: el.scrollTop, real: realTop(), floor: el.scrollHeight - el.clientHeight })
    }
  }
  const ro = new ResizeObserver(() => follow())
  ro.observe(column); ro.observe(composer)
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const frame = () => new Promise(r => requestAnimationFrame(r))
  const commit = opts => {
    if (opts.submission || opts.user || (opts.tipMoved && atBottomRef)) toBottom()
  }
  const addRow = (className, h) => {
    const r = document.createElement('div')
    r.className = className
    r.style.height = h + 'px'
    column.appendChild(r)
  }
  return {
    el, column, composer, realTop, desc: nativeDesc,
    get atBottom() { return atBottomRef },
    drain() { const out = events; events = []; return out },
    toBottom, follow, commit, addRow, sleep, frame,
  }
})()

;(() => {
  const h = window.host
  const sleep = h.sleep
  const frame = h.frame
  let n = 0
  const reset = async (rows = 30) => {
    h.column.innerHTML = ''
    h.composer.classList.add('tall')
    h.drain()
    for (let i = 0; i < rows; i++) h.addRow('row', 64)
    await frame()
    h.toBottom()
    await sleep(120)
    return h.realTop() === (h.el.scrollHeight - h.el.clientHeight)
  }
  const appendBubble = text => {
    let b = h.column.querySelector('.bubble')
    if (b === null) { b = document.createElement('div'); b.className = 'bubble'; h.column.appendChild(b) }
    b.textContent += text
  }
  const stream = async (deltas, paceMs) => {
    for (let i = 0; i < deltas; i++) {
      appendBubble('chunk-' + (n++) + ' stream text '.repeat(4))
      h.commit({ tipMoved: true })
      await sleep(paceMs)
    }
  }
  const send = opts => {
    h.addRow('user-row', opts.echoHeight ?? 48)
    if (opts.clearDraft) h.composer.classList.remove('tall')
    h.commit({ submission: true })
  }
  const durable = opts => {
    const echo = h.column.querySelector('.user-row')
    if (echo) echo.remove()
    h.addRow('user-row', opts.height ?? 48)
    h.commit({ user: true })
  }
  const scenarios = {
    // 报告的重现场景：发送一条消息后回复开始流式。
    sendThenStream: async () => {
      await reset()
      send({ clearDraft: true })
      await sleep(150)
      stream(24, 30)
      await sleep(1200)
    },
    sendThenStreamLateShrink: async () => {
      await reset()
      send({ clearDraft: false })
      await sleep(60)
      h.composer.classList.remove('tall')
      await h.frame()
      await sleep(100)
      stream(24, 30)
      await sleep(1200)
    },
    sendThenStreamDurableSwap: async () => {
      await reset()
      send({ clearDraft: true })
      await sleep(80)
      durable({ height: 60 })
      await sleep(100)
      stream(24, 30)
      await sleep(1200)
    },
    sendThenFastReply: async () => {
      await reset()
      send({ clearDraft: true })
      await sleep(40)
      stream(24, 30)
      await sleep(1200)
    },
    sendFromScrolledUp: async () => {
      await reset()
      h.el.scrollTop -= 300
      await frame(); await sleep(60)
      send({ clearDraft: true })
      await sleep(150)
      stream(24, 30)
      await sleep(1200)
    },
    doubleSend: async () => {
      await reset()
      send({ clearDraft: true })
      await sleep(80)
      send({ clearDraft: true })
      await sleep(100)
      stream(24, 30)
      await sleep(1200)
    },
    // 回归点：追击中途上方行塌陷 → 浏览器滚动锚定（非用户输入），必须继续跟随。
    anchorShiftMidChase: async () => {
      await reset()
      h.el.scrollTop -= 600
      await h.frame(); await h.sleep(60)
      send({ clearDraft: true })
      await h.sleep(120)
      const first = h.column.querySelector('.row')
      first.style.height = '8px'
      await h.sleep(80)
      stream(24, 30)
      await sleep(1200)
    },
    anchorShiftMidTail: async () => {
      await reset()
      h.el.scrollTop -= 600
      await h.frame(); await h.sleep(60)
      send({ clearDraft: true })
      await h.sleep(450)
      const first = h.column.querySelector('.row')
      first.style.height = '8px'
      await h.sleep(80)
      stream(24, 30)
      await sleep(1200)
    },
    lateComposerShrinkMidChase: async () => {
      await reset()
      h.el.scrollTop -= 600
      await h.frame(); await h.sleep(60)
      send({ clearDraft: false })
      await h.sleep(120)
      h.composer.classList.remove('tall')
      await h.frame()
      await h.sleep(80)
      stream(24, 30)
      await sleep(1200)
    },
    streamWithAboveShift: async () => {
      await reset()
      send({ clearDraft: true })
      await sleep(150)
      let i = 0
      for (i = 0; i < 12; i++) { appendBubble('chunk-' + n++ + ' stream text '.repeat(4)); h.commit({ tipMoved: true }); await sleep(30) }
      const first = h.column.querySelector('.row')
      first.style.height = '200px'
      await h.sleep(30)
      for (; i < 24; i++) { appendBubble('chunk-' + n++ + ' stream text '.repeat(4)); h.commit({ tipMoved: true }); await sleep(30) }
      await sleep(1200)
    },
    bigDeltaMidChase: async () => {
      await reset()
      send({ clearDraft: true })
      await sleep(40)
      appendBubble('tool output line '.repeat(600))
      h.commit({ tipMoved: true })
      await sleep(100)
      stream(10, 30)
      await sleep(1200)
    },
    sendWhileStreaming: async () => {
      await reset()
      send({ clearDraft: true })
      await sleep(60)
      stream(12, 30)
      send({ clearDraft: true })
      for (let i = 0; i < 12; i++) { appendBubble('chunk-' + n++ + ' stream text '.repeat(4)); h.commit({ tipMoved: true }); await sleep(30) }
      await sleep(1200)
    },
    // 回归点：真实读者拖拽（持续偏离）必须停止动画并让宿主脱钩。
    takeoverMidChase: async () => {
      await reset()
      h.el.scrollTop -= 600
      await h.frame(); await h.sleep(60)
      send({ clearDraft: true })
      await h.sleep(120)
      const rawWrite = delta => void h.desc.set.call(h.el, h.desc.get.call(h.el) + delta)
      rawWrite(-200); await h.frame()
      rawWrite(-120); await h.frame()
      rawWrite(-100); await h.frame()
      rawWrite(-60)
      await h.sleep(60)
      stream(24, 30)
      await sleep(1200)
    },
  }
  const report = () => {
    const floor = h.el.scrollHeight - h.el.clientHeight
    return {
      atBottomRef: h.atBottom,
      distanceFromBottom: Math.round((floor - h.realTop()) * 10) / 10,
      events: h.drain().slice(-8),
    }
  }
  window.repro = {
    scenarios,
    run: async name => { await scenarios[name](); return report() },
    reset,
  }
})()
`

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(resolveChromium() === undefined ? {} : { executablePath: resolveChromium() }),
  })
  const page = await browser.newPage()
  await page.setContent(PAGE)
  await page.evaluate(() => {
    window.__ModuleLoader__ = { load(registration) { window.__registration = registration } }
  })
  await page.addScriptTag({ path: PLUGIN_PATH })
  await page.evaluate(() => {
    const registration = window.__registration
    const exports = registration.factory(() => { throw new Error('bundle must not require()') })
    exports.apply({ effect(callback) { callback() } })
  })
  await page.addScriptTag({ content: HOST_JS })
  await page.evaluate(() => window.repro.reset())

  const cases = [
    ['sendThenStream', true],
    ['sendThenStreamLateShrink', true],
    ['sendThenStreamDurableSwap', true],
    ['sendThenFastReply', true],
    ['sendFromScrolledUp', true],
    ['doubleSend', true],
    ['anchorShiftMidChase', true],
    ['anchorShiftMidTail', true],
    ['lateComposerShrinkMidChase', true],
    ['streamWithAboveShift', true],
    ['bigDeltaMidChase', true],
    ['sendWhileStreaming', true],
    ['takeoverMidChase', false],
  ]
  let failed = 0
  for (const [name, expectPinned] of cases) {
    const report = await page.evaluate(name => window.repro.run(name), name)
    const ok = expectPinned
      ? report.atBottomRef && report.distanceFromBottom <= 1
      : !report.atBottomRef && report.distanceFromBottom > 25
    if (!ok) {
      failed += 1
      for (const ev of report.events) console.error('   ', JSON.stringify(ev))
    }
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} (atBottom=${report.atBottomRef}, 距离=${report.distanceFromBottom}px)`)
  }
  await browser.close()
  if (failed > 0) process.exit(1)
  console.log(`\nscroll-follow 回归测试全部通过（${cases.length} 个场景）`)
}

main().catch(error => { console.error(error); process.exit(1) })
