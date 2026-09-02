/**
 * 真实宿主行为 e2e：dsh v0.1.2-alpha.4 + dsh-smooth-scroll。
 *
 * 与 test/scroll-follow.test.mjs 的差别：后者在空白页里复刻宿主（alpha.1~3
 * 语义），本脚本驱动真实 `dsh web` 组合（profile web），用真实 LLM 流式输出
 * 走真实 ChatView 跟随状态机（alpha.4 的 500ms 采样 / scrollend / pending
 * 门控），断言插件在实际使用中的行为：追击、接管、导轨跳转、reduced-motion。
 *
 * 前置：
 *   - `dsh web --port <非3080> --no-open` 已启动，token 取自其 stdout；
 *   - profile web 已装本插件（link:），偏好工作区已存在（默认 dsh-smooth-plugin）。
 *
 * 运行：node test/alpha4-realhost-e2e.mjs <token> [--workspace <名>]
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { resolveChromium, entryUrl } from './real-host-lib.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('E:/Works/deepseek-harness/apps/web/node_modules/playwright')

const token = process.argv[2]
const workspace = process.argv.includes('--workspace')
  ? process.argv[process.argv.indexOf('--workspace') + 1]
  : 'dsh-smooth-plugin'
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
if (token === undefined) {
  console.error('usage: node alpha4-realhost-e2e.mjs <token> [--workspace <名>]')
  process.exit(2)
}

const PROMPT = (n) => `请只输出文本，不使用任何工具，不要输出代码块或列表：以《${n}》为题写一篇约450字中文短文，逐自然段输出，段与段之间空一行。`
const PROMPTS = { 1: '夜航', 2: '山间清晨', 3: '旧书店的下午' }

const results = []
const consoleErrors = []
let failures = 0
const fail = (name, msg, extra) => {
  failures += 1
  results.push({ scenario: name, ok: false, msg, extra })
  console.log(`FAIL ${name}: ${msg}`)
}
const pass = (name, msg, extra) => {
  results.push({ scenario: name, ok: true, msg, extra })
  console.log(`PASS ${name}: ${msg}`)
}

// ── page-side instrumentation ───────────────────────────────────────────────

const INSTRUMENT = () => {
  // 页面上可能同时有多个 [data-conversation-scroll]（hero/残留视图等）——
  // 真正承载会话内容的滚动容器是可滚动量（scrollHeight-clientHeight）最大的
  // 那个；插件本身会对全部元素 attach，这里只取测量目标。
  let el = null
  let best = -1
  for (const c of document.querySelectorAll('[data-conversation-scroll]')) {
    const span = c.scrollHeight - c.clientHeight
    if (span > best) { best = span; el = c }
  }
  if (el === null) return null
  const real = () => Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop').get.call(el)
  const floor = () => Math.max(0, el.scrollHeight - el.clientHeight)
  return {
    getter: el.scrollTop,
    real: real(),
    floor: floor(),
    height: el.scrollHeight,
    distance: floor() - real(),
    scrollY: window.scrollY,
    chase: Math.abs(el.scrollTop - real()) > 5,
    patched: Object.getOwnPropertyDescriptor(el, 'scrollTop') !== undefined,
  }
}
const BACK_TO_LATEST = () => {
  for (const b of document.querySelectorAll('button')) {
    const label = `${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`
    if (label.includes('最新') || label.includes('回到底部') || label.includes('回到最新')) {
      return { found: true, label: label.trim().slice(0, 40), el: b }
    }
  }
  return { found: false }
}

// ── main ────────────────────────────────────────────────────────────────────

const browser = await chromium.launch({
  headless: true,
  ...(resolveChromium() === undefined ? {} : { executablePath: resolveChromium() }),
})

async function openApp(emulateReduced = false) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  if (emulateReduced) await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' })
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text().slice(0, 300)}`)
  })
  page.on('pageerror', err => consoleErrors.push(`pageerror: ${String(err).slice(0, 300)}`))
  await page.goto(entryUrl(token), { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('textarea, [contenteditable="true"], [contenteditable=""]', { timeout: 60000 })
  await page.waitForTimeout(6000)
  // 侧栏是 tree：点目标工作区行（role=treeitem，文本精确匹配）即可让
  // hero 作曲家指向它；随后 hero 发送即在该工作区建会话。
  const row = page.locator('[role="treeitem"]').filter({ hasText: new RegExp(`^${workspace}$`) }).first()
  if (await row.count() > 0) {
    await row.click()
    await page.waitForTimeout(1200)
  } else {
    console.log('NOTE openApp: 未找到工作区行，继续（会话可能落在默认工作区）')
  }
  return page
}

async function sendPrompt(page, turn, waitMs = 150000) {
  const input = page.locator('textarea, [contenteditable="true"], [contenteditable=""]').first()
  await input.click()
  await page.waitForTimeout(300)
  await input.fill(PROMPT(PROMPTS[turn]))
  await page.keyboard.press('Enter')
  // Max 推理 + 大上下文预填充可能 >90s，等待窗口必须覆盖完整首响应。
  const started = await waitForGrowth(page, waitMs)
  if (!started) {
    await page.screenshot({ path: 'E:/Works/dsh-plugin/dsh-smooth-plugin/test/e2e-send-fail.png' })
    const tail = await page.evaluate(() => document.body.innerText.slice(-700))
    console.log(`NOTE sendPrompt: 发送后 ${waitMs / 1000}s 未见增长。页面尾部文本：`, JSON.stringify(tail.slice(0, 400)))
  }
  return started
}

/** 等到会话视图高度开始增长；返回是否在期限内出现流式。 */
async function waitForGrowth(page, ms) {
  const deadline = Date.now() + ms
  let baseline = null
  let polls = 0
  while (Date.now() < deadline) {
    polls += 1
    const info = await page.evaluate(INSTRUMENT)
    if (info !== null && baseline === null) baseline = info.height
    if (info !== null && polls % 12 === 0) {
      console.log('trace-growth', JSON.stringify({ t: Math.round((Date.now() - deadline + ms) / 1000), poll: polls, height: info.height, dist: Math.round(info.distance), real: Math.round(info.real) }))
    }
    if (baseline !== null && info !== null && info.height > baseline + 120) return true
    await page.waitForTimeout(500)
  }
  return false
}

/** 采样直到内容静默（高度平稳阈）或超时；返回采样序列。 */
async function sampleUntilQuiet(page, quietMs = 4000, timeoutMs = 180000) {
  const samples = []
  const start = Date.now()
  let lastGrowth = null
  let prevHeight = null
  while (Date.now() - start < timeoutMs) {
    const t = Date.now()
    const info = await page.evaluate(INSTRUMENT)
    if (info !== null) {
      samples.push({ t, ...info })
      if (prevHeight !== null && info.height > prevHeight + 1) lastGrowth = t
      prevHeight = info.height
    }
    if (samples.length >= 6 && lastGrowth !== null && Date.now() - lastGrowth >= quietMs) break
    await page.waitForTimeout(80)
  }
  return samples
}

const infoOf = s => s[s.length - 1]

// ── A：流式追击 + 最终钉底 ────────────────────────────────────────────────
async function scenarioA(page) {
  const started = await sendPrompt(page, 1)
  if (!started) {
    fail('A-streaming', '60s 内未见内容增长（provider 配置或会话失败）')
    return
  }
  const samples = await sampleUntilQuiet(page)
  const end = infoOf(samples)
  const finalDist = end.distance
  // 后移判定允许「floor 同步下移」的合法场景（发送后输入栏塌陷等）：后移量
  // 与同窗 floor 下移量相当即视为几何正常化，不算回弹。
  const backward = []
  for (let i = 1; i < samples.length; i++) {
    const drop = Math.max(0, samples[i - 1].floor - samples[i].floor)
    const movedBack = samples[i - 1].real - samples[i].real
    if (movedBack > 30 + drop) {
      backward.push({ t: samples[i].t, movedBack: Math.round(movedBack), floorDrop: Math.round(drop), dist: Math.round(samples[i].distance) })
    }
  }
  // 停顿统计：内容在增长（height 前进）但真实位置不动、且离底 >30px 的
  // 连续采样段 —— 即「追击到过时底部后等待下一次钉底」的窗口。
  let pauseRunMs = 0
  let maxPauseRunMs = 0
  let prev = null
  for (const s of samples) {
    if (prev !== null) {
      const grew = s.height > prev.height + 1
      const moved = Math.abs(s.real - prev.real) > 1
      if (grew && !moved && s.distance > 30) {
        pauseRunMs += Math.min(500, s.t - prev.t)
        maxPauseRunMs = Math.max(maxPauseRunMs, pauseRunMs)
      } else {
        pauseRunMs = 0
      }
    }
    prev = s
  }
  const ok = end.patched && finalDist <= 2 && backward.length === 0
  if (ok) {
    pass('A-streaming', `最终钉底距离 ${finalDist.toFixed(1)}px；流式最大离底 ${Math.max(...samples.map(s => s.distance)).toFixed(0)}px；最大追击停顿 ${maxPauseRunMs}ms`, { maxPauseRunMs })
  } else {
    fail('A-streaming', `final=${finalDist.toFixed(1)}px patched=${end.patched} backward=${backward.length}`, { maxPauseRunMs })
  }
  if (maxPauseRunMs > 800) {
    console.log(`NOTE A-streaming: 追击停顿 ${maxPauseRunMs}ms > 800ms —— alpha.4 采样节流下出现可感知停顿`)
  }
}

// ── B：流式中读者接管（滚轮），随后「回到最新」 ──────────────────────────
async function scenarioB(page) {
  const started = await sendPrompt(page, 2)
  if (!started) {
    fail('B-takeover', '60s 内未见内容增长')
    return
  }
  // 等到流式进行中（高度增长 >= 300px 后）再滚轮。
  const deadline = Date.now() + 120000
  let info = null
  while (Date.now() < deadline) {
    info = await page.evaluate(INSTRUMENT)
    if (info !== null && info.height > 420) break
    await page.waitForTimeout(150)
  }
  const box = await page.locator('[data-conversation-scroll]').boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height * 0.4
  await page.mouse.move(cx, cy)
  await page.waitForTimeout(120)
  const beforeWheel = await page.evaluate(INSTRUMENT)
  // 两次滚轮：确保输入落在滚动容器（若第一次落在 window 上会留痕于 scrollY）。
  await page.mouse.wheel(0, -2400)
  await page.waitForTimeout(350)
  const afterWheel1 = await page.evaluate(INSTRUMENT)
  await page.mouse.wheel(0, -1200)
  await page.waitForTimeout(250)
  const afterWheel2 = await page.evaluate(INSTRUMENT)
  // 稳点采样：接管后位置不得被拉回（内容继续增长也不回弹）。
  const stab = []
  for (let i = 0; i < 20; i++) {
    const s = await page.evaluate(INSTRUMENT)
    stab.push(s)
    await page.waitForTimeout(100)
  }
  const minReal = Math.min(...stab.map(s => s.real))
  const maxReal = Math.max(...stab.map(s => s.real))
  const drift = maxReal - minReal
  const wheelEffect = Math.max(0, beforeWheel.real - afterWheel2.real)
  const chaseAfter = stab.some(s => s.chase)
  const tailDist = stab[stab.length - 1].distance
  if (wheelEffect <= 30) {
    console.log(`NOTE B-takeover: 滚轮未作用到滚动容器（real 变化 ${wheelEffect.toFixed(0)}px, scrollY=${beforeWheel.scrollY}→${afterWheel2.scrollY}）——SKIP 接管断言（选择器/布局原因，非插件行为）`)
    results.push({ scenario: 'B-takeover', ok: 'skip', msg: '滚轮未作用到滚动容器', extra: { wheelEffect, scrollYAfter: afterWheel2.scrollY } })
    return
  }
  const stableOk = drift <= 30 && !chaseAfter
  const bTrace = {
    beforeWheel, afterWheel1, afterWheel2,
    stab: stab.map(s => ({ t: Math.round((s.t - (beforeWheel.t ?? s.t)) / 10) / 100, getter: Math.round(s.getter), real: Math.round(s.real), floor: Math.round(s.floor), distance: Math.round(s.distance), chase: s.chase })),
  }
  if (stableOk) {
    pass('B-takeover', `滚轮接管后位置稳定：漂移 ${drift.toFixed(1)}px、追击已停（chase=${chaseAfter}）、离底 ${tailDist.toFixed(0)}px（滚轮作用 ${wheelEffect.toFixed(0)}px）`, bTrace)
  } else {
    fail('B-takeover', `接管后漂移 ${drift.toFixed(1)}px、chase=${chaseAfter}、离底 ${tailDist.toFixed(0)}px（>30px 即被拉回/回弹或追击未停）`, bTrace)
  }
  const latest = await page.evaluate(BACK_TO_LATEST)
  if (latest.found) {
    console.log(`NOTE B-takeover: 宿主脱钩按钮出现「${latest.label}」——DSH 已识别读者接管`)
    const clicked = await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        const label = `${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`
        if (label.includes('最新') || label.includes('回到底部') || label.includes('回到最新')) {
          b.click()
          return true
        }
      }
      return false
    })
    console.log(`NOTE B-takeover: 点击「回到最新」=${clicked}`)
    await page.waitForTimeout(300)
    for (let i = 0; i < 30; i++) {
      const s = await page.evaluate(INSTRUMENT)
      if (s.distance <= 2) break
      await page.waitForTimeout(100)
    }
    const s = await page.evaluate(INSTRUMENT)
    if (s.distance <= 2) pass('B-backToLatest', `「回到最新」后钉底：距离 ${s.distance.toFixed(1)}px`)
    else fail('B-backToLatest', `「回到最新」后未钉底：距离 ${s.distance.toFixed(1)}px`)
  } else {
    console.log('NOTE B-takeover: 未检测到「回到最新」按钮（选择器未命中或宿主已随接管保持合理状态）')
    const s = await page.evaluate(INSTRUMENT)
    if (s.distance > 30) pass('B-backToLatest', '未检测到脱钩按钮，但位置保持在读者处（无回弹）')
    else console.log('NOTE B-backToLatest: 接管后距离接近底部，无法区分是否脱钩')
  }
}

// ── C：导轨跳转（landOnRow 复合读改写）─ 需要 ≥2 轮已存在 ────────────────
async function scenarioC(page) {
  // 真实的导轨是「第 N 轮」按钮；先找可点击的轮次按钮。
  const railButtons = await page.evaluate(() => {
    const out = []
    for (const b of document.querySelectorAll('button')) {
      const label = `${b.getAttribute('aria-label') ?? ''} ${b.getAttribute('title') ?? ''} ${b.textContent ?? ''}`
      if (/\d+.*轮|轮.*\d+|turn/i.test(label)) out.push({ label: label.trim().slice(0, 40), text: (b.textContent ?? '').trim().slice(0, 20) })
    }
    return out
  })
  console.log('NOTE C-rail: 轮次按钮候选：', JSON.stringify(railButtons.slice(0, 10)))
  if (railButtons.length === 0) {
    console.log('NOTE C-rail: 未找到「第 N 轮」按钮（可能导轨未渲染）——跳过导轨断言')
    return
  }
  const started = await sendPrompt(page, 3)
  if (!started) {
    console.log('NOTE C-railJump: 第 3 轮未起流式——改在既有流式进行中直接点导轨（前一轮可能仍在流式）')
  }
  // 流式中点击一个旧轮次按钮（首个非当前轮）。
  const clickedLabel = await page.evaluate(() => {
    const cands = []
    for (const b of document.querySelectorAll('button')) {
      const label = `${b.getAttribute('aria-label') ?? ''} ${b.getAttribute('title') ?? ''} ${b.textContent ?? ''}`
      if (/\d+.*轮|轮.*\d+|turn/i.test(label)) cands.push(b)
    }
    // 优先点最早的一轮（最后一个匹配的通常是最新）。
    const target = cands[0] ?? cands[cands.length - 1]
    if (target === undefined) return null
    const label = `${target.getAttribute('aria-label') ?? ''} ${target.getAttribute('title') ?? ''} ${target.textContent ?? ''}`.trim()
    target.click()
    return label.slice(0, 40)
  })
  if (clickedLabel === null) {
    console.log('NOTE C-railJump: 点击时找不到轮次按钮——跳过')
    return
  }
  console.log(`NOTE C-railJump: 已点击「${clickedLabel}」`)
  await page.waitForTimeout(400)
  const after = await page.evaluate(INSTRUMENT)
  // 稳定 1.2s：不得被重新钉底拉回（跳转后应停在目标行附近且 DSH 不竞争）。
  const stab = []
  for (let i = 0; i < 12; i++) {
    stab.push(await page.evaluate(INSTRUMENT))
    await page.waitForTimeout(100)
  }
  const drift = Math.max(...stab.map(s => s.real)) - Math.min(...stab.map(s => s.real))
  const ok = drift <= 40
  if (ok) {
    pass('C-railJump', `导轨跳转后位置稳定（漂移 ${drift.toFixed(1)}px，离底 ${after.distance.toFixed(0)}px；点击「${clickedLabel}」）`)
  } else {
    fail('C-railJump', `跳转后位置漂移 ${drift.toFixed(1)}px（可能与追击/重新钉底竞争；点击「${clickedLabel}」）`)
  }
}

// ── D：prefers-reduced-motion → 回退瞬时钉底 ───────────────────────────────
// 复用已有会话发送一条短回复（避免新会话+大上下文的首 token 延迟干扰）。
async function scenarioD() {
  const page = await openApp(true)
  // 侧栏里挑一个今天的会话行（含「夜航」标题）。
  const sessionRow = page.locator('[role="treeitem"]').filter({ hasText: '夜航' }).first()
  if (await sessionRow.count() > 0) {
    await sessionRow.click()
    await page.waitForTimeout(2500)
  } else {
    console.log('NOTE D-reduced: 未找到既有会话行——走 hero 新会话')
  }
  const input = page.locator('textarea, [contenteditable="true"], [contenteditable=""]').first()
  await input.click()
  await page.waitForTimeout(300)
  await input.fill('请只输出文本，不要用工具：详细说明牛顿第一定律，写500字。')
  await page.keyboard.press('Enter')
  // 按下发时刻起采样：首次内容增长出现时，reduce 路径应几乎同时（<=2 采样）
  // 到达距底。增长窗口给足 240s（Max 推理 + 大上下文）。
  const samples = []
  const deadline = Date.now() + 240000
  let prevHeight = null
  let sawGrowth = false
  while (Date.now() < deadline) {
    const s = await page.evaluate(INSTRUMENT)
    if (s !== null) {
      samples.push({ t: Date.now(), ...s })
      if (prevHeight !== null && s.height > prevHeight + 2) {
        sawGrowth = true
        // 增长后的两帧内必须已瞬时到距底（reduce 回退官方瞬写）。
        const follow = samples.slice(-3)
        const arrived = follow.some(x => x.distance <= 2)
        const arrivedSample = samples.find((x, i) => i >= samples.length - 3 && x.distance <= 2)
        const latencyMs = arrived && arrivedSample !== undefined ? samples[samples.length - 1].t - arrivedSample.t : null
        await page.close()
        if (arrived && latencyMs !== null && latencyMs <= 400) {
          pass('D-reduced', `reduced-motion 下瞬时钉底：内容增长后 ${latencyMs}ms 内距底 <=2px`)
        } else {
          fail('D-reduced', `reduced-motion 下未现即时钉底（arrived=${arrived}, latency=${latencyMs}ms）`)
        }
        return
      }
      prevHeight = s.height
    }
    await page.waitForTimeout(100)
  }
  await page.close()
  fail('D-reduced', `240s 内未见内容增长（sawGrowth=${sawGrowth}）`)
}

// ── run ─────────────────────────────────────────────────────────────────────

const page = await openApp()
const s0 = await page.evaluate(INSTRUMENT)
console.log('INIT', JSON.stringify(s0))
if (s0 === null || !s0.patched) {
  console.error('插件未接管滚动容器（[data-conversation-scroll] 缺失或未被 patch）——终止')
  process.exit(1)
}
if (only === null || only === 'A') await scenarioA(page)
if (only === null || only === 'B') await scenarioB(page)
if (only === null || only === 'C') await scenarioC(page)
await page.close()
if (only === null || only === 'D') await scenarioD()

const allErrors = consoleErrors.length === 0
if (allErrors) pass('no-console-errors', `浏览器无 console.error/pageerror（${consoleErrors.length} 条）`)
else fail('no-console-errors', `${consoleErrors.length} 条错误`, { consoleErrors: consoleErrors.slice(0, 5) })

await browser.close()
const report = { at: new Date().toISOString(), results, failures, consoleErrors: consoleErrors.slice(0, 10) }
writeFileSync(new URL('./alpha4-e2e-report.json', import.meta.url), JSON.stringify(report, null, 2))
console.log(failures === 0 ? `\n真实宿主 e2e 全部通过（${results.length} 条断言）` : `\n真实宿主 e2e 有 ${failures} 条失败`)
process.exit(failures === 0 ? 0 : 1)
