#!/usr/bin/env bash
# eds-tui installer — Linux/macOS. See install.ps1 for Windows.
#
# Quick install:
#   curl -fsSL https://raw.githubusercontent.com/edantonio505/eds-tui-js/main/install.sh | bash
#
# Why this exists instead of just `npm install -g eds-tui`: the npm
# registry publish for this package is currently stuck on an old version
# (account access issue on the publishing side, unrelated to this repo's
# code) and, separately, `npm install -g git+https://github.com/...` for
# THIS repo has been confirmed unreliable in real testing — it can report
# success while silently producing an incomplete install (no dist/, or even
# a completely empty package directory), with no visible error. That
# appears to be npm's own internal git-dependency fetch/cache machinery,
# not this project's packaging (dist/ is committed to git specifically so a
# git-based install has real code to use regardless).
#
# This script avoids that code path entirely: a plain `git clone` (not
# npm's own git-fetch), then `npm pack` on the LOCAL checkout (which just
# tars up local files — no network/git dependency resolution involved at
# all), then `npm install -g` that tarball. Confirmed reliable in repeated
# testing where the direct git-URL install was not. Safe to re-run to
# upgrade — it always clones fresh.

set -euo pipefail

REPO_URL="https://github.com/edantonio505/eds-tui-js.git"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js >=20 is required. Install it first: https://nodejs.org" >&2
  exit 1
fi
NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR:-0}" -lt 20 ] 2>/dev/null; then
  echo "Node.js >=20 is required (found $(node -v 2>/dev/null || echo 'none')). Install a newer version: https://nodejs.org" >&2
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  echo "git is required to install eds-tui reliably right now. Install it first." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Cloning eds-tui-js..."
git clone --depth 1 -q "$REPO_URL" "$TMP"

echo "Packing..."
TARBALL="$(cd "$TMP" && npm pack --silent 2>/dev/null | tail -1)"
if [ -z "$TARBALL" ] || [ ! -f "$TMP/$TARBALL" ]; then
  echo "npm pack did not produce a tarball — aborting." >&2
  exit 1
fi

echo "Installing the ask CLI..."
npm install -g "$TMP/$TARBALL"

echo
echo "Done — run 'ask' from any shell."
