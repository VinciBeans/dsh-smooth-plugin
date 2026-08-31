/**
 * Smoke test for the built DSH browser-half plugin.
 *
 * Part 1 — module contract: loads lib/client.js through the same
 * __ModuleLoader__ shape the DSH web client uses
 * (window.__ModuleLoader__.load({ id, factory })), then verifies:
 *   - exactly one bundle registers, under the package id 'dsh-smooth-scroll';
 *   - the factory is a function;
 *   - materializing it requires nothing outside the module table (the bundle
 *     is fully self-contained — no react, no @deepseek-ai/* words);
 *   - the materialized exports carry the Cordis plugin face ({ apply }).
 *
 * Part 2 — functional wiring: invokes apply() with a stub ctx whose effect()
 * runs its callback synchronously (as Cordis does), backed by minimal browser
 * stubs, and asserts the effect registers a disposer that cleans up without
 * throwing. This exercises the attach/scan/listener plumbing end to end.
 */
import assert from 'node:assert/strict'

// ── Part 1: module contract ───────────────────────────────────────────────

const registrations = []
globalThis.window = {
  __ModuleLoader__: {
    load(registration) { registrations.push(registration) },
  },
}

await import(new URL('../lib/client.js', import.meta.url).href)

assert.equal(registrations.length, 1, 'expected exactly one bundle registration')
const registration = registrations[0]
assert.equal(registration.id, 'dsh-smooth-scroll')
assert.equal(typeof registration.factory, 'function')

// Materialize exactly like ClientModuleSystem.makeRequire would, but the
// bundle must not require anything — a require call is a build-time
// externals drift and fails the test loudly.
const moduleExports = registration.factory((spec) => {
  throw new Error(`unexpected require("${spec}") — bundle must be self-contained`)
})

assert.equal(typeof moduleExports, 'object')
assert.equal(typeof moduleExports.apply, 'function')

// ── Part 2: functional wiring ──────────────────────────────────────────────

// Minimal browser surface the effect body touches. attach() finds no
// [data-conversation-scroll] elements, so no scrollTop patching runs; the
// observer and scroll listener still register and must be torn down.
globalThis.document = {
  body: {},
  documentElement: {},
  querySelectorAll: () => [],
}
globalThis.requestAnimationFrame = () => 1
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
}
globalThis.matchMedia = () => ({ matches: false })

let effectCallback = null
const ctx = {
  effect(callback) {
    effectCallback = callback
    return () => {}
  },
}

moduleExports.apply(ctx)
assert.equal(typeof effectCallback, 'function', 'apply must register a ctx.effect')

const disposer = effectCallback()
assert.equal(typeof disposer, 'function', 'the effect must return a disposer')
assert.doesNotThrow(() => disposer(), 'disposer must clean up without throwing')

console.log('smooth-scroll smoke test ok (contract + self-contained apply face + wiring)')
