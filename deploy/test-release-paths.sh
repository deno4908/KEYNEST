#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source <(sed -n '/^previous_release()/,/^}/p' "$script_dir/release.sh")
test_root="$(mktemp -d)"
trap 'rm -rf -- "$test_root"' EXIT
mkdir -p "$test_root/releases/old/server" "$test_root/releases/old/dist"
printf 'server\n' > "$test_root/releases/old/server/index.js"
printf 'html\n' > "$test_root/releases/old/dist/index.html"
[[ -z "$(previous_release "$test_root")" ]] # First deploy has no current.
ln -s "$test_root/current" "$test_root/current"
[[ -z "$(previous_release "$test_root")" ]] # Existing self-loop.
rm "$test_root/current"
ln -s "$test_root/releases/missing" "$test_root/current"
[[ -z "$(previous_release "$test_root")" ]] # Broken link.
rm "$test_root/current"
ln -s "$test_root/releases/old" "$test_root/current"
[[ "$(previous_release "$test_root")" == "$test_root/releases/old" ]]
rm "$test_root/releases/old/dist/index.html"
[[ -z "$(previous_release "$test_root")" ]] # Incomplete release.
echo 'Release path regression checks passed.'
