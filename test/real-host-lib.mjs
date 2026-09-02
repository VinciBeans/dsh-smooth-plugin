/** Shared helpers for the alpha.4 real-host e2e (browser + URL construction). */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Pick the newest installed Playwright chromium headless shell. */
export function resolveChromium() {
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
    /* fall back to Playwright's own resolution */
  }
  return undefined
}

export function entryUrl(token) {
  return `http://127.0.0.1:3415/?token=${encodeURIComponent(token)}`
}
