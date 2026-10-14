#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source <(sed -n '/^previous_release()/,/^}/p; /^prune_children()/,/^}/p' "$script_dir/release.sh")
test_root="$(mktemp -d)"
trap 'rm -rf -- "$test_root"' EXIT
mkdir -p "$test_root/releases/old/server" "$test_root/releases/old/dist"
printf 'server\n' > "$test_root/releases/old/server/index.js"
printf 'html\n' > "$test_root/releases/old/dist/index.html"
[[ -z "$(previous_release "$test_root")" ]] # First deploy has no current.
if ln -s "$test_root/current" "$test_root/current" 2>/dev/null; then
  [[ -z "$(previous_release "$test_root")" ]] # Existing self-loop.
  rm "$test_root/current"
  ln -s "$test_root/releases/missing" "$test_root/current"
  [[ -z "$(previous_release "$test_root")" ]] # Broken link.
  rm "$test_root/current"
  ln -s "$test_root/releases/old" "$test_root/current"
  [[ "$(previous_release "$test_root")" == "$test_root/releases/old" ]]
  rm "$test_root/releases/old/dist/index.html"
  [[ -z "$(previous_release "$test_root")" ]] # Incomplete release.
else
  echo 'Symlink-specific checks skipped on this filesystem.'
fi

# Pruning only removes direct release/incoming directories outside the keep set.
base="$test_root"
mkdir -p "$test_root/releases/current" "$test_root/releases/backup" \
  "$test_root/releases/stale" "$test_root/incoming/current" "$test_root/incoming/stale" \
  "$test_root/external"
prune_children "$test_root/releases" "$test_root/releases/current" "$test_root/releases/backup"
[[ -d "$test_root/releases/current" && -d "$test_root/releases/backup" ]]
[[ ! -e "$test_root/releases/stale" ]]
if ln -s "$test_root/external" "$test_root/releases/external-link" 2>/dev/null &&
   [[ -L "$test_root/releases/external-link" ]]; then
  prune_children "$test_root/releases" "$test_root/releases/current" "$test_root/releases/backup"
  [[ -L "$test_root/releases/external-link" && -d "$test_root/external" ]]
else
  rm -rf -- "$test_root/releases/external-link"
fi
prune_children "$test_root/incoming" "$test_root/incoming/current"
[[ -d "$test_root/incoming/current" && ! -e "$test_root/incoming/stale" ]]
if prune_children "$test_root/unrelated" >/dev/null 2>&1; then exit 1; fi
echo 'Release path regression checks passed.'
