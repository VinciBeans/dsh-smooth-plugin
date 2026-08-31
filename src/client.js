/**
 * dsh-smooth-scroll — browser half (transform-free).
 *
 * Official chat auto-scroll pins `[data-conversation-scroll]` instantly. This
 * plugin instead animates the NATIVE scrollTop with a paced JS motion model
 * while a synthetic getter reports the pin target to DSH, so the app's own
 * follow-state machine (observedTopRef / movedByReader) never sees any
 * intermediate movement and never detaches mid-glide.
 *
 * Motion model:
 *  - velocity chase: constant 0.9px/ms pursuit; content appends only update
 *    the target (no per-append curve restart → no slow-start crawl);
 *  - ramp-up: 0 → cruise over 240ms (smoothstep) on each chase start;
 *  - soft tail: when the stream is quiet (>240ms) and <=120px remains,
 *    a 220ms ease-out settles the rest;
 *  - reader takeover: a single-frame native divergence (browser scroll
 *    anchoring — a UA adjustment with no user intent) is re-based and the
 *    glide continues; divergence persisting across ≥2 frames instead ends
 *    the glide — a reader drag keeps driving the scroller, and a floor clamp
 *    (content shrinking under a stale target) diverges every frame until it
 *    stops — after which the getter reports the real position again and DSH
 *    stays pinned (clamp landed on the floor) or detaches as usual (reader);
 *  - same-destination pin writes (DSH's per-scroll-event toBottom fallback)
 *    are ignored so the animation is never restarted per frame.
 *
 * No transforms are ever applied: the composer overlay and sticky seat are
 * never displaced (no jumpy input bar, no fuzzy text, no runaway offsets).
 */

const VEL = 0.9          // px/ms cruise velocity
const RAMP_MS = 240      // warm-up: 0 -> cruise over this window
const QUIET_MS = 240     // quiet before the soft tail arms
const TAIL_PX = 120      // remaining distance that eases out
const TAIL_MS = 220
// 真实位置连续偏离动画写入的帧数阈值：单帧偏离多为浏览器滚动锚定等
// 一次性非用户位移（重基后继续追击即可）；连续 ≥2 帧的持续偏离才是
// 读者拖拽/滚轮输入，或目标随内容收窄被夹紧失效，此时停止动画并交还
// 宿主（getter 返回真实位置，由 DSH 状态机判定）。
const DIVERGE_STOP_FRAMES = 2

const easeOut = (t) => 1 - Math.pow(1 - t, 3)
const smooth = (t) => t * t * (3 - 2 * t)
const now = () => (typeof performance === 'object' && performance !== null &&
  typeof performance.now === 'function') ? performance.now() : Date.now()

function apply(ctx) {
  ctx.effect(() => {
    const doc = document
    const root = doc.body ?? doc.documentElement
    if (typeof MutationObserver !== 'function' ||
        typeof requestAnimationFrame !== 'function') return
    const reduced = typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches
    const states = new Map()

    const readTop = (state) =>
      state.chase || state.settle !== null ? state.target : state.desc.get.call(state.el)

    const stopAll = (state) => {
      state.chase = false
      state.settle = null
      state.farN = 0
    }

    const tick = (state, ts) => {
      if (!state.el.isConnected) { stopAll(state); return }
      if (state.lastTs === 0) state.lastTs = ts
      const dt = Math.min(50, ts - state.lastTs)
      state.lastTs = ts
      const pos = state.desc.get.call(state.el)
      if (state.settle === null && !state.chase) {
        state.farN = 0
        return
      }
      // 读者接管判定：以「连续帧偏离」为准，而非单个 scroll 事件。单帧偏离
      // 多为滚动锚定等一次性非用户位移，重基后继续追击；连续 ≥2 帧偏离
      // （真实拖拽/滚轮输入，或目标随内容收窄被夹紧）才停止动画。
      if (Math.abs(pos - state.lastWrite) > 0.5) {
        state.farN += 1
        if (state.farN >= DIVERGE_STOP_FRAMES) {
          state.farN = 0
          stopAll(state)
          return
        }
        state.lastWrite = pos
        if (state.settle !== null) {
          // 软尾写入基于 from/to 曲线，偏离后无法直接续用 → 转回恒速追击。
          state.settle = null
          state.chase = true
          state.chaseStart = ts
        }
      } else {
        state.farN = 0
      }
      if (state.settle !== null) {
        const s = state.settle
        const t = Math.min(1, (ts - s.start) / s.ms)
        const v = s.from + (s.to - s.from) * easeOut(t)
        state.lastWrite = v
        state.desc.set.call(state.el, v)
        if (t >= 1) {
          state.settle = null
          state.lastTs = 0
          return
        }
        requestAnimationFrame((t2) => tick(state, t2))
        return
      }
      if (!state.chase) {
        state.chase = false
        state.lastTs = 0
        return
      }
      const remaining = Math.max(0, state.target) - pos
      if (Math.abs(remaining) <= 0.5) {
        state.desc.set.call(state.el, Math.max(0, state.target))
        state.chase = false
        state.lastTs = 0
        return
      }
      if (Math.abs(remaining) <= TAIL_PX && now() - state.lastPinTs > QUIET_MS) {
        state.settle = { from: pos, to: state.target, start: ts, ms: TAIL_MS }
        state.chase = false
        requestAnimationFrame((t2) => tick(state, t2))
        return
      }
      const ramp = Math.min(1, Math.max(0, (ts - state.chaseStart) / RAMP_MS))
      const v = VEL * smooth(ramp)
      const step = Math.sign(remaining) * Math.min(Math.abs(remaining), v * dt)
      const nv = pos + step
      state.lastWrite = nv
      state.desc.set.call(state.el, nv)
      requestAnimationFrame((t2) => tick(state, t2))
    }

    const writeScrollTop = (state, desc, value) => {
      const el = state.el
      // 先强制布局（scrollHeight 会触发），再读当前位置：夹紧/锚定只在
      // 布局后生效，先读会拿到夹紧前的缓存值，导致钉底判定失真。
      const max = Math.max(0, el.scrollHeight - el.clientHeight)
      const current = desc.get.call(el)
      const target = Math.min(value, max)
      const pinIntent = value >= max - 1
      const isPin = pinIntent && Math.abs(target - current) > 0.5
      if (!isPin) {
        if (Math.abs(target - current) > 0.5) {
          stopAll(state)
          desc.set.call(el, value)
        } else if (pinIntent && (state.chase || state.settle !== null)) {
          // 钉底写但真实位置已在目的地：若动画目标因夹紧/锚定而早已
          // 过期，立即对齐归一，避免继续朝一个超出新夹紧范围的旧目标追。
          state.target = target
          stopAll(state)
          state.lastWrite = current
        }
        return
      }
      if (reduced) {
        desc.set.call(el, value)
        return
      }
      // Initial load / big catch-up jumps are instant by intent:
      // - the first pin after attach is the session open (pin at bottom now);
      // - a jump beyond ~2x viewport is a "jump to latest" gesture, not a
      //   content follow — animating it would crawl for seconds.
      const firstPin = state.firstPin
      state.firstPin = false
      const big = Math.abs(target - current) > state.el.clientHeight * 2
      if (firstPin || big) {
        state.target = null
        state.chase = false
        state.settle = null
        desc.set.call(el, value)
        return
      }
      state.target = target
      state.settle = null
      state.lastPinTs = now()
      if (!state.chase) {
        // 仅追击启动时对齐基线：lastWrite 可能来自早已结束的上一段追击，
        // 不重置会让首个 tick 误计一次偏离（会被单帧吸收路径兜住，但仍是
        // 噪音）。重钉底（chase 已在跑）绝不能重置——宿主钉底时每个 scroll
        // 事件都会重跑 toBottom，若此处清零 farN/lastWrite，真实拖拽的
        // 连续偏离会被逐帧吞掉：动画永不停止、与用户持续对抗。
        state.chase = true
        state.chaseStart = now()
        state.lastTs = 0
        state.lastWrite = current
        state.farN = 0
        requestAnimationFrame((t2) => tick(state, t2))
      }
    }

    const attach = (el) => {
      if (states.has(el) || typeof el.querySelector !== 'function') return
      let proto = el
      let desc = null
      while (proto !== null) {
        const candidate = Object.getOwnPropertyDescriptor(proto, 'scrollTop')
        if (candidate !== undefined) { desc = candidate; break }
        proto = Object.getPrototypeOf(proto)
      }
      if (desc === null || typeof desc.get !== 'function' || typeof desc.set !== 'function') return
      const state = {
        el, desc, firstPin: true,
        chase: false, settle: null, target: null, lastPinTs: 0, lastTs: 0,
        lastWrite: 0, chaseStart: 0, farN: 0,
      }
      states.set(el, state)
      Object.defineProperty(el, 'scrollTop', {
        configurable: true,
        enumerable: false,
        get() { return readTop(state) },
        set(value) { writeScrollTop(state, desc, value) },
      })
    }

    const disposeState = (state) => {
      stopAll(state)
      const scrollDesc = Object.getOwnPropertyDescriptor(state.el, 'scrollTop')
      // Only delete an own, configurable property — the one attach() installed.
      // Deleting a non-configurable property would throw, and when the
      // descriptor is already gone there is nothing left to clean up, so no
      // try/catch is needed.
      if (scrollDesc !== undefined && scrollDesc.configurable) {
        delete state.el.scrollTop
      }
      states.delete(state.el)
    }

    const scan = () => {
      for (const el of doc.querySelectorAll('*[data-conversation-scroll]')) attach(el)
      for (const [el, state] of states) if (!el.isConnected) disposeState(state)
    }
    let scanQueued = false
    const queueScan = () => {
      if (scanQueued) return
      scanQueued = true
      requestAnimationFrame(() => { scanQueued = false; scan() })
    }

    // 接管判定在 tick 内以连续帧偏离为准：滚动锚定等一次性非用户位移
    // 也会产生 scroll 事件，按事件立即判定会误杀追击。
    const observer = new MutationObserver(queueScan)
    observer.observe(root, { childList: true, subtree: true })
    queueScan()

    return () => {
      observer.disconnect()
      for (const state of [...states.values()]) disposeState(state)
    }
  })
}

export { apply }
