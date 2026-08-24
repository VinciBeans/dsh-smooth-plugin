#!/usr/bin/env bash
# Install dsh-smooth-scroll into the REAL web profile (~/.dsh/profiles/web).
#
# Works on:
#   - Linux / macOS (any bash)
#   - Windows: Git Bash, MSYS2, Cygwin, or WSL
#
# Notes:
#   - Takes effect only after the running 'dsh web' GUI is restarted
#     (plugin-set changes are read at boot).
#   - Uses pnpm 'link:' so edits in the source dir are live.
#   - Does NOT overwrite an existing cordis.patch.yml; appends the plugin
#     entry only when absent.
set -euo pipefail

# ---------------------------------------------------------------------------
# Windows bootstrap
# ---------------------------------------------------------------------------

# CRLF guard: re-exec an LF-only copy of ourselves so the script also runs
# from WSL or Linux on a CRLF checkout.
if [ "${SMOOTH_SELF_FIXED:-0}" != "1" ] && LC_ALL=C grep -q "$(printf '\r')" "$0" 2>/dev/null; then
  SMOOTH_SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
  _self_lf="$(mktemp "${TMPDIR:-/tmp}/dsh-smooth-scroll-install.XXXXXX")"
  LC_ALL=C tr -d '\r' < "$0" > "$_self_lf"
  SMOOTH_SELF_FIXED=1 SMOOTH_SRC_DIR="$SMOOTH_SRC_DIR" exec bash "$_self_lf" "$@"
fi

is_windows() {
  [ -n "${USERPROFILE:-}" ] && [ -n "${WINDIR:-}" ]
}

win_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s' "$1" | sed -e 's|^/\([A-Za-z]\)/|\1:/|' -e 's|\\|/|g'
  fi
}

if [ -n "${SMOOTH_SRC_DIR:-}" ]; then
  PLUGIN_DIR="$SMOOTH_SRC_DIR"
else
  PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [ -n "${DSH_HOME:-}" ]; then
  DSH_HOME_DIR="$DSH_HOME"
elif is_windows; then
  DSH_HOME_DIR="$USERPROFILE/.dsh"
else
  DSH_HOME_DIR="$HOME/.dsh"
fi
PROFILE_DIR="$DSH_HOME_DIR/profiles/web"

if is_windows; then
  PLUGIN_DIR="$(win_path "$PLUGIN_DIR")"
  PROFILE_DIR="$(win_path "$PROFILE_DIR")"
fi

ENTRY_ID="smooth-scroll"

if [ ! -d "$PLUGIN_DIR" ] || [ ! -f "$PLUGIN_DIR/package.json" ]; then
  echo "plugin source not found: $PLUGIN_DIR" >&2
  exit 1
fi
if [ ! -d "$PROFILE_DIR" ]; then
  echo "DSH web profile not found: $PROFILE_DIR" >&2
  echo "Have you started 'dsh web' at least once?" >&2
  exit 1
fi

cd "$PROFILE_DIR"

run_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    pnpm "$@"
  elif command -v corepack >/dev/null 2>&1; then
    corepack pnpm "$@"
  else
    echo "error: neither 'pnpm' nor 'corepack' found on PATH" >&2
    exit 1
  fi
}

echo "==> adding plugin dependency (link:) to $PROFILE_DIR"
run_pnpm add "link:$PLUGIN_DIR"

PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"
if [ -f "$PATCH_FILE" ] && grep -q "id: $ENTRY_ID" "$PATCH_FILE"; then
  echo "==> $ENTRY_ID already present in $PATCH_FILE"
else
  echo "==> appending $ENTRY_ID to $PATCH_FILE"
  cat >> "$PATCH_FILE" <<'PATCH'
- insert:
    - id: smooth-scroll
      name: 'dsh-smooth-scroll'
PATCH
fi

echo "==> done. Restart the GUI (stop 'dsh web', run it again) to activate."
