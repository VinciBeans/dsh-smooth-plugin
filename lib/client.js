window.__ModuleLoader__.load({ id: "dsh-smooth-scroll", factory: (require) => { var module = { exports: {} }; var exports = module.exports; Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.js
var client_exports = {};
__export(client_exports, {
  apply: () => apply
});
module.exports = __toCommonJS(client_exports);
var VEL = 0.9;
var RAMP_MS = 240;
var QUIET_MS = 240;
var TAIL_PX = 120;
var TAIL_MS = 220;
var DIVERGE_STOP_FRAMES = 2;
var easeOut = (t) => 1 - Math.pow(1 - t, 3);
var smooth = (t) => t * t * (3 - 2 * t);
var now = () => typeof performance === "object" && performance !== null && typeof performance.now === "function" ? performance.now() : Date.now();
function apply(ctx) {
  ctx.effect(() => {
    const doc = document;
    const root = doc.body ?? doc.documentElement;
    if (typeof MutationObserver !== "function" || typeof requestAnimationFrame !== "function") return;
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const states = /* @__PURE__ */ new Map();
    const readTop = (state) => state.chase || state.settle !== null ? state.target : state.desc.get.call(state.el);
    const stopAll = (state) => {
      state.chase = false;
      state.settle = null;
      state.farN = 0;
    };
    const tick = (state, ts) => {
      if (!state.el.isConnected) {
        stopAll(state);
        return;
      }
      if (state.lastTs === 0) state.lastTs = ts;
      const dt = Math.min(50, ts - state.lastTs);
      state.lastTs = ts;
      const pos = state.desc.get.call(state.el);
      if (state.settle === null && !state.chase) {
        state.farN = 0;
        return;
      }
      if (Math.abs(pos - state.lastWrite) > 0.5) {
        state.farN += 1;
        if (state.farN >= DIVERGE_STOP_FRAMES) {
          state.farN = 0;
          stopAll(state);
          return;
        }
        state.lastWrite = pos;
        if (state.settle !== null) {
          state.settle = null;
          state.chase = true;
          state.chaseStart = ts;
        }
      } else {
        state.farN = 0;
      }
      if (state.settle !== null) {
        const s = state.settle;
        const t = Math.min(1, (ts - s.start) / s.ms);
        const v2 = s.from + (s.to - s.from) * easeOut(t);
        state.lastWrite = v2;
        state.desc.set.call(state.el, v2);
        if (t >= 1) {
          state.settle = null;
          state.lastTs = 0;
          return;
        }
        requestAnimationFrame((t2) => tick(state, t2));
        return;
      }
      if (!state.chase) {
        state.chase = false;
        state.lastTs = 0;
        return;
      }
      const remaining = Math.max(0, state.target) - pos;
      if (Math.abs(remaining) <= 0.5) {
        state.desc.set.call(state.el, Math.max(0, state.target));
        state.chase = false;
        state.lastTs = 0;
        return;
      }
      if (Math.abs(remaining) <= TAIL_PX && now() - state.lastPinTs > QUIET_MS) {
        state.settle = { from: pos, to: state.target, start: ts, ms: TAIL_MS };
        state.chase = false;
        requestAnimationFrame((t2) => tick(state, t2));
        return;
      }
      const ramp = Math.min(1, Math.max(0, (ts - state.chaseStart) / RAMP_MS));
      const v = VEL * smooth(ramp);
      const step = Math.sign(remaining) * Math.min(Math.abs(remaining), v * dt);
      const nv = pos + step;
      state.lastWrite = nv;
      state.desc.set.call(state.el, nv);
      requestAnimationFrame((t2) => tick(state, t2));
    };
    const writeScrollTop = (state, desc, value) => {
      const el = state.el;
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      const current = desc.get.call(el);
      const target = Math.min(value, max);
      const pinIntent = value >= max - 1;
      const isPin = pinIntent && Math.abs(target - current) > 0.5;
      if (!isPin) {
        if (Math.abs(target - current) > 0.5) {
          stopAll(state);
          desc.set.call(el, value);
        } else if (pinIntent && (state.chase || state.settle !== null)) {
          state.target = target;
          stopAll(state);
          state.lastWrite = current;
        }
        return;
      }
      if (reduced) {
        desc.set.call(el, value);
        return;
      }
      const firstPin = state.firstPin;
      state.firstPin = false;
      const big = Math.abs(target - current) > state.el.clientHeight * 2;
      if (firstPin || big) {
        state.target = null;
        state.chase = false;
        state.settle = null;
        desc.set.call(el, value);
        return;
      }
      state.target = target;
      state.settle = null;
      state.lastPinTs = now();
      if (!state.chase) {
        state.chase = true;
        state.chaseStart = now();
        state.lastTs = 0;
        state.lastWrite = current;
        state.farN = 0;
        requestAnimationFrame((t2) => tick(state, t2));
      }
    };
    const attach = (el) => {
      if (states.has(el) || typeof el.querySelector !== "function") return;
      let proto = el;
      let desc = null;
      while (proto !== null) {
        const candidate = Object.getOwnPropertyDescriptor(proto, "scrollTop");
        if (candidate !== void 0) {
          desc = candidate;
          break;
        }
        proto = Object.getPrototypeOf(proto);
      }
      if (desc === null || typeof desc.get !== "function" || typeof desc.set !== "function") return;
      const state = {
        el,
        desc,
        firstPin: true,
        chase: false,
        settle: null,
        target: null,
        lastPinTs: 0,
        lastTs: 0,
        lastWrite: 0,
        chaseStart: 0,
        farN: 0
      };
      const stopOnPointerDown = (event) => {
        if (!state.chase && state.settle === null) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest("[data-composer-seat]") !== null) return;
        stopAll(state);
      };
      state.stopOnPointerDown = stopOnPointerDown;
      el.addEventListener("pointerdown", stopOnPointerDown, true);
      states.set(el, state);
      Object.defineProperty(el, "scrollTop", {
        configurable: true,
        enumerable: false,
        get() {
          return readTop(state);
        },
        set(value) {
          writeScrollTop(state, desc, value);
        }
      });
    };
    const disposeState = (state) => {
      stopAll(state);
      state.el.removeEventListener("pointerdown", state.stopOnPointerDown, true);
      const scrollDesc = Object.getOwnPropertyDescriptor(state.el, "scrollTop");
      if (scrollDesc !== void 0 && scrollDesc.configurable) {
        delete state.el.scrollTop;
      }
      states.delete(state.el);
    };
    const scan = () => {
      for (const el of doc.querySelectorAll("*[data-conversation-scroll]")) attach(el);
      for (const [el, state] of states) if (!el.isConnected) disposeState(state);
    };
    let scanQueued = false;
    const queueScan = () => {
      if (scanQueued) return;
      scanQueued = true;
      requestAnimationFrame(() => {
        scanQueued = false;
        scan();
      });
    };
    const observer = new MutationObserver(queueScan);
    observer.observe(root, { childList: true, subtree: true });
    queueScan();
    return () => {
      observer.disconnect();
      for (const state of [...states.values()]) disposeState(state);
    };
  });
}
return module.exports; } });
