window.__ModuleLoader__.load({ id: "dsh-smooth-scroll", factory: (require) => { var module = { exports: {} }; var exports = module.exports; Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
// dsh-smooth-scroll — browser half (hand-built CJS bundle, matches the
// esbuild output shape: window.__ModuleLoader__.load + module.exports).
// Rebuild with: node scripts/build.mjs  (src/client.js is the source).

var VEL = 0.9;          // px/ms cruise velocity
var RAMP_MS = 240;      // warm-up: 0 -> cruise over this window
var QUIET_MS = 240;     // quiet before the soft tail arms
var TAIL_PX = 120;      // remaining distance that eases out
var TAIL_MS = 220;

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function smooth(t) { return t * t * (3 - 2 * t); }
function now() {
  return (typeof performance === "object" && performance !== null &&
    typeof performance.now === "function") ? performance.now() : Date.now();
}

function apply(ctx) {
  ctx.effect(function () {
    var doc = document;
    var root = doc.body ?? doc.documentElement;
    if (typeof MutationObserver !== "function" ||
        typeof requestAnimationFrame !== "function") return;
    var reduced = typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    var states = new Map();
    var announced = false;

    function readTop(state) {
      return state.chase || state.settle !== null ? state.target : state.desc.get.call(state.el);
    }

    function stopAll(state) {
      state.chase = false;
      state.settle = null;
      state.rafId = 0;
    }

    function tick(state, ts) {
      state.rafId = 0;
      if (!state.el.isConnected) { stopAll(state); return; }
      if (state.lastTs === 0) state.lastTs = ts;
      var dt = Math.min(50, ts - state.lastTs);
      state.lastTs = ts;
      if (state.settle !== null) {
        var s = state.settle;
        var t = Math.min(1, (ts - s.start) / s.ms);
        var v = s.from + (s.to - s.from) * easeOut(t);
        state.lastWrite = v;
        state.desc.set.call(state.el, v);
        if (t >= 1) {
          state.settle = null;
          state.lastTs = 0;
          return;
        }
        state.rafId = requestAnimationFrame(function (t2) { tick(state, t2); });
        return;
      }
      if (!state.chase || state.target === null) {
        state.chase = false;
        state.lastTs = 0;
        return;
      }
      var pos = state.desc.get.call(state.el);
      var remaining = Math.max(0, state.target) - pos;
      if (Math.abs(remaining) <= 0.5) {
        state.desc.set.call(state.el, Math.max(0, state.target));
        state.chase = false;
        state.lastTs = 0;
        return;
      }
      if (Math.abs(remaining) <= TAIL_PX && now() - state.lastPinTs > QUIET_MS) {
        state.settle = { from: pos, to: state.target, start: ts, ms: TAIL_MS };
        state.chase = false;
        state.rafId = requestAnimationFrame(function (t2) { tick(state, t2); });
        return;
      }
      var ramp = Math.min(1, Math.max(0, (ts - state.chaseStart) / RAMP_MS));
      var vv = VEL * smooth(ramp);
      var step = Math.sign(remaining) * Math.min(Math.abs(remaining), vv * dt);
      var nv = pos + step;
      state.lastWrite = nv;
      state.desc.set.call(state.el, nv);
      state.rafId = requestAnimationFrame(function (t2) { tick(state, t2); });
    }

    function writeScrollTop(state, desc, value) {
      var el = state.el;
      var current = desc.get.call(el);
      var max = Math.max(0, el.scrollHeight - el.clientHeight);
      var target = Math.min(value, max);
      state.pinnedTop = target;
      var isPin = value >= max - 1 && Math.abs(target - current) > 0.5;
      if (!isPin) {
        if (Math.abs(target - current) > 0.5) {
          stopAll(state);
          desc.set.call(el, value);
        }
        return;
      }
      if (reduced) {
        desc.set.call(el, value);
        return;
      }
      // Initial load / big catch-up jumps are instant by intent:
      // - the first pin after attach is the session open (pin at bottom now);
      // - a jump beyond ~2x viewport is a "jump to latest" gesture, not a
      //   content follow — animating it would crawl for seconds.
      var firstPin = state.firstPin;
      state.firstPin = false;
      var big = Math.abs(target - current) > state.el.clientHeight * 2;
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
        state.rafId = requestAnimationFrame(function (t2) { tick(state, t2); });
      }
    }

    function attach(el) {
      if (states.has(el) || typeof el.querySelector !== "function") return;
      var proto = el;
      var desc = null;
      while (proto !== null) {
        var candidate = Object.getOwnPropertyDescriptor(proto, "scrollTop");
        if (candidate !== undefined) { desc = candidate; break; }
        proto = Object.getPrototypeOf(proto);
      }
      if (desc === null || typeof desc.get !== "function" || typeof desc.set !== "function") return;
      var state = {
        el: el, desc: desc, flow: null, pinnedTop: -1, firstPin: true,
        chase: false, settle: null, target: null, lastPinTs: 0, lastTs: 0,
        rafId: 0, lastWrite: 0, chaseStart: 0,
      };
      states.set(el, state);
      Object.defineProperty(el, "scrollTop", {
        configurable: true,
        enumerable: false,
        get: function () { return readTop(state); },
        set: function (value) { writeScrollTop(state, desc, value); },
      });
      if (!announced) {
        announced = true;
        console.log("[dsh-smooth-scroll] attached to the conversation scroller");
      }
    }

    function disposeState(state) {
      stopAll(state);
      if (Object.prototype.hasOwnProperty.call(state.el, "scrollTop")) {
        try { delete state.el.scrollTop; } catch (e) { /* already gone */ }
      }
      state.flow = null;
      states.delete(state.el);
    }

    function scan() {
      for (var el of doc.querySelectorAll("*[data-conversation-scroll]")) attach(el);
      for (var entry of states) if (!entry[0].isConnected) disposeState(entry[1]);
    }
    var scanQueued = false;
    function queueScan() {
      if (scanQueued) return;
      scanQueued = true;
      requestAnimationFrame(function () { scanQueued = false; scan(); });
    }

    function onDocScroll(event) {
      var target = event.target;
      if (target === null || target === undefined) return;
      var state = states.get(target);
      if (state === undefined) return;
      var real = state.desc.get.call(state.el);
      if ((state.chase || state.settle !== null) &&
          Math.abs(real - state.lastWrite) > 0.5) {
        stopAll(state);
      }
    }
    doc.addEventListener("scroll", onDocScroll, { capture: true, passive: true });

    var observer = new MutationObserver(queueScan);
    observer.observe(root, { childList: true, subtree: true });
    queueScan();

    return function () {
      observer.disconnect();
      doc.removeEventListener("scroll", onDocScroll, true);
      for (var entry of states) disposeState(entry[1]);
    };
  });
}

module.exports = { apply: apply };
return module.exports; } });
