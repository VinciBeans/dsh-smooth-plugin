/**
 * 端到端回归测试：真实 Chromium 中验证 dsh-smooth-scroll 的钉底跟随。
 *
 * 页面复刻 DSH 宿主的几何与跟随状态机（ChatView 的 toBottom /
 * observedTopRef 账本 / movedByReader·isAtBottom 滚动处理 / ResizeObserver
 * 跟随），并加载构建产物 lib/client.js。随后运行发送、流式、浏览器锚定位移、
 * 真实读者拖拽等交错场景，断言宿主是否仍钉底、最终距离是否为 0。
 *
 * 回归点（接管判定必须区分的两类偏移）：
 *   - anchorShiftMidChase / anchorShiftMidTail：追击中上方行塌陷触发浏览器
 *     滚动锚定（非用户输入）——不得触发接管：误判会停止动画、以 >25px 距离
 *     脱钩，流式内容不再被跟随；必须吸收后继续跟随到底。
 *   - takeoverMidChase / takeoverWithRepins：真实读者持续拖拽——必须触发
 *     接管：停止动画并正常脱钩（偏离计数不得被宿主每事件钉底写吞掉）。
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
  #scroll.no-anchor { overflow-anchor: none; }
  #view { flex: 1 0 auto; min-height: auto; }
  #column { display: flex; flex-direction: column; gap: 8px; padding: 8px; }
  .row { flex: none; background: #eef; border-radius: 4px; }
  .user-row { flex: none; background: #dfd; border-radius: 4px; }
  .bubble { background: #fee; border-radius: 4px; padding: 4px; white-space: pre-wrap; }
  #rail { flex: none; position: sticky; top: 0; z-index: 6; background: #fff; }
  #railTarget { height: 22px; border: 0; background: #eee; }
  #composerSeat { flex: none; position: sticky; bottom: 0; z-index: 7; background: #fff; }
  #composerCard { height: 52px; background: #ccc; }
  #composerSeat.tall #composerCard { height: 208px; }
</style></head>
<body>
  <div id="root">
    <div id="scroll" data-conversation-scroll="">
      <div id="view">
        <div id="rail"><button id="railTarget" type="button" data-chat-anchor-key="t9" data-turn="9">turn 9</button></div>
        <div id="column"></div>
      </div>
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
  // alpha.3 的 landOnRowRef 复刻（ChatView.tsx:406）：
  // 复合读改写「el.scrollTop += flowTop(row, el) - 24」读到的正是插件
  // 合成 getter 当前报告的值；返回写入后的目标行 flowTop 供断言落点。
  const landOnRow = (turn) => {
    const row = column.querySelector('[data-chat-anchor-key="t' + turn + '"]')
    el.scrollTop += (row.getBoundingClientRect().top - el.getBoundingClientRect().top) - 24
    observedTopRef = el.scrollTop
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1
    atBottomRef = isAtBottom
    log({ t: 'landOnRow', turn, getter: el.scrollTop, real: realTop(), floor: el.scrollHeight - el.clientHeight })
    return Math.round((row.getBoundingClientRect().top - el.getBoundingClientRect().top) * 10) / 10
  }
  return {
    el, column, composer, realTop, desc: nativeDesc,
    get atBottom() { return atBottomRef },
    drain() { const out = events; events = []; return out },
    toBottom, commit, addRow, sleep, frame, landOnRow,
  }
})()

;(() => {
  const h = window.host
  const sleep = h.sleep
  const frame = h.frame
  let n = 0
  const reset = async () => {
    h.column.innerHTML = ''
    h.composer.classList.add('tall')
    h.drain()
    for (let i = 0; i < 30; i++) h.addRow('row', 64)
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
    h.addRow('user-row', 48)
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
    // 回归点（alpha.3 新增 jump-to-turn 机制）：追击进行中点击导轨跳到
    // 旧 turn——宿主 landOnRow 的复合写「el.scrollTop += flowTop - 24」
    // 必须读到真实位置（pointerdown 先停动画），落点行才停在阅读线
    // （flowTop ≈ 24）；否则落点偏移剩余追击距离。
    railClickMidChase: async () => {
      // 复刻页默认的浏览器滚动锚定会在钉底时把真实位置顶到新底部，host
      // 的钉底写到达时 |target - real| 已 ≈ 0（isPin 为假，追击不启动），
      // 「追击进行中」的状态无法复现。关闭锚定后钉底写才留下
      // |target - real| > 0.5 的差值，追击真实滞后，场景才能覆盖
      // 「复合读改写读到合成目标」这一失败路径。
      h.el.classList.add('no-anchor')
      await reset()
      send({ clearDraft: true })
      await h.sleep(150)
      // 流式进行中点击导轨：最后一次 commit 后【立即】（不加 sleep）
      // 执行 pointerdown + 宿主 landOnRow。
      stream(14, 30)
      const target = h.column.querySelector('.row')
      target.dataset.chatAnchorKey = 't9'
      target.dataset.turn = '9'
      const railBtn = document.getElementById('railTarget')
      railBtn.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      }))
      await h.frame()
      const getterBefore = h.el.scrollTop
      window.scenarioResult = {
        landOnRow: h.landOnRow('9'),
        getterBefore,
        realBefore: h.realTop(),
        chaseActive: getterBefore !== h.realTop(),
      }
      await h.sleep(300)
      await h.frame()
      h.el.classList.remove('no-anchor')
    },
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
    // 回归点：DSH 钉底时每个 scroll 事件都会在 onScroll 里重跑 toBottom
    // （getter 掩盖中间位置时保持钉底），重钉写不得重置接管计数——
    // 持续小幅拖拽在每事件重钉底之下仍必须停止动画并让宿主脱钩。
    takeoverWithRepins: async () => {
      await reset()
      h.el.scrollTop -= 600
      await h.frame(); await h.sleep(60)
      send({ clearDraft: true })
      await h.sleep(120)
      const rawWrite = delta => void h.desc.set.call(h.el, h.desc.get.call(h.el) + delta)
      for (let i = 0; i < 8; i++) {
        rawWrite(-60)          // 宿主 onScroll 随每个 scroll 事件重跑 toBottom
        await h.frame()
      }
      await h.sleep(300)
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
    run: async name => { await scenarios[name](); return { ...report(), ...(window.scenarioResult ?? {}) } },
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
    ['railClickMidChase', 'land'],
    ['takeoverMidChase', false],
    ['takeoverWithRepins', false],
  ]
  let failed = 0
  for (const [name, expectPinned] of cases) {
    const report = await page.evaluate(name => window.repro.run(name), name)
    const ok = expectPinned === true
      ? report.atBottomRef && report.distanceFromBottom <= 1
      : expectPinned === 'land'
        ? Math.abs((report.landOnRow ?? 0) - 24) <= 8
        : !report.atBottomRef && report.distanceFromBottom > 25
    if (!ok) {
      failed += 1
      for (const ev of report.events) console.error('   ', JSON.stringify(ev))
    }
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} (atBottom=${report.atBottomRef}, 距离=${report.distanceFromBottom}px, 落点=${report.landOnRow}px${report.chaseActive === undefined ? '' : `, 点击时追击=${report.chaseActive}(getter=${report.getterBefore}/real=${report.realBefore})`})`)
  }
  await browser.close()
  if (failed > 0) process.exit(1)
  console.log(`\nscroll-follow 回归测试全部通过（${cases.length} 个场景）`)
}

main().catch(error => { console.error(error); process.exit(1) })
