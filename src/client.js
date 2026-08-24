/**
 * dsh-smooth-scroll — browser half (final architecture: transform-free).
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
 *  - reader takeover: a native position diverging from the animation's own
 *    last write can only come from the user → stop animating, the getter
 *    reports the real position again and DSH detaches as usual;
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
    let announced = false

    const readTop = (state) =>
      state.chase || state.settle !== null ? state.target : state.desc.get.call(state.el)

    const stopAll = (state) => {
      state.chase = false
      state.settle = null
      state.rafId = 0
    }

    const tick = (state, ts) => {
      state.rafId = 0
      if (!state.el.isConnected) { stopAll(state); return }
      if (state.lastTs === 0) state.lastTs = ts
      const dt = Math.min(50, ts - state.lastTs)
      state.lastTs = ts
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
        state.rafId = requestAnimationFrame((t2) => tick(state, t2))
        return
      }
      if (!state.chase || state.target === null) {
        state.chase = false
        state.lastTs = 0
        return
      }
      const pos = state.desc.get.call(state.el)
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
        state.rafId = requestAnimationFrame((t2) => tick(state, t2))
        return
      }
      const ramp = Math.min(1, Math.max(0, (ts - state.chaseStart) / RAMP_MS))
      const v = VEL * smooth(ramp)
      const step = Math.sign(remaining) * Math.min(Math.abs(remaining), v * dt)
      const nv = pos + step
      state.lastWrite = nv
      state.desc.set.call(state.el, nv)
      state.rafId = requestAnimationFrame((t2) => tick(state, t2))
    }

    const writeScrollTop = (state, desc, value) => {
      const el = state.el
      const current = desc.get.call(el)
      const max = Math.max(0, el.scrollHeight - el.clientHeight)
      const target = Math.min(value, max)
      state.pinnedTop = target
      const isPin = value >= max - 1 && Math.abs(target - current) > 0.5
      if (!isPin) {
        if (Math.abs(target - current) > 0.5) {
          stopAll(state)
          desc.set.call(el, value)
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
        state.chase = true
        state.chaseStart = now()
        state.lastTs = 0
        state.rafId = requestAnimationFrame((t2) => tick(state, t2))
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
        el, desc, flow: null, pinnedTop: -1, firstPin: true,
        chase: false, settle: null, target: null, lastPinTs: 0, lastTs: 0,
        rafId: 0, lastWrite: 0, chaseStart: 0,
      }
      states.set(el, state)
      Object.defineProperty(el, 'scrollTop', {
        configurable: true,
        enumerable: false,
        get() { return readTop(state) },
        set(value) { writeScrollTop(state, desc, value) },
      })
      if (!announced) {
        announced = true
        console.log('[dsh-smooth-scroll] attached to the conversation scroller')
      }
    }

    const disposeState = (state) => {
      stopAll(state)
      if (Object.prototype.hasOwnProperty.call(state.el, 'scrollTop')) {
        try { delete state.el.scrollTop } catch (e) { /* already gone */ }
      }
      state.flow = null
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

    const onDocScroll = (event) => {
      const target = event.target
      if (target === null || target === undefined) return
      const state = states.get(target)
      if (state === undefined) return
      const real = state.desc.get.call(state.el)
      if ((state.chase || state.settle !== null) &&
          Math.abs(real - state.lastWrite) > 0.5) {
        // reader took over mid-motion
        stopAll(state)
      }
    }
    doc.addEventListener('scroll', onDocScroll, { capture: true, passive: true })

    const observer = new MutationObserver(queueScan)
    observer.observe(root, { childList: true, subtree: true })
    queueScan()

    return () => {
      observer.disconnect()
      doc.removeEventListener('scroll', onDocScroll, true)
      for (const state of [...states.values()]) disposeState(state)
    }
  })
}

export { apply }
