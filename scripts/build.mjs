/**
 * Build dsh-smooth-scroll:
 *   - lib/index.js   — node half (ESM), the empty host-side plugin body
 *   - lib/client.js  — browser half, a closure-factory CJS bundle in the exact
 *                      shape the DSH client module system expects:
 *                      window.__ModuleLoader__.load({ id, factory: (require) => ... })
 *
 * Usage:
 *   pnpm install        # installs the esbuild devDependency
 *   pnpm run build      # or: node scripts/build.mjs
 */
import { mkdir } from 'node:fs/promises'

let esbuild
try {
  esbuild = (await import('esbuild')).default ?? (await import('esbuild'))
} catch {
  console.error('esbuild is not installed in this package.')
  console.error('Run `pnpm install` (or `npm install`) first, then retry.')
  process.exit(1)
}

const ID = 'dsh-smooth-scroll'

await mkdir('lib', { recursive: true })

// ── node half ─────────────────────────────────────────────────────────────
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: 'lib/index.js',
  logLevel: 'info',
})

// ── browser half ──────────────────────────────────────────────────────────
await esbuild.build({
  entryPoints: ['src/client.js'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  outfile: 'lib/client.js',
  logLevel: 'info',
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports; Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });`,
  },
  footer: {
    js: `return module.exports; } });`,
  },
})

console.log('build complete: lib/index.js + lib/client.js')
