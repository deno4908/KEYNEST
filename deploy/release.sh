#!/usr/bin/env bash
set -euo pipefail
umask 077
# readlink -f can return a nonexistent path. Only an existing, complete release
# resolved before activation is a valid rollback target.
previous_release() {
  local root="$1" candidate
  [[ -L "$root/current" ]] || return 0
  candidate="$(readlink -e "$root/current" 2>/dev/null || true)"
  case "$candidate" in
    "$root/releases/"*)
      if [[ -d "$candidate" && -s "$candidate/server/index.js" && -s "$candidate/dist/index.html" ]]; then
        printf '%s\n' "$candidate"
      fi
      ;;
  esac
}
prune_children() {
  local parent="$1" candidate keep should_keep
  shift
  case "$parent" in
    "$base/releases"|"$base/incoming") ;;
    *) echo "Refusing to prune outside deployment directories: $parent" >&2; return 2 ;;
  esac
  [[ -d "$parent" && ! -L "$parent" ]] || return 0
  for candidate in "$parent"/*; do
    [[ -e "$candidate" || -L "$candidate" ]] || continue
    case "$candidate" in
      "$parent"/*) ;;
      *) echo "Refusing to prune unexpected path: $candidate" >&2; return 2 ;;
    esac
    should_keep=false
    for keep in "$@"; do
      if [[ "$candidate" == "$keep" ]]; then should_keep=true; break; fi
    done
    [[ "$should_keep" == true ]] && continue
    [[ -d "$candidate" && ! -L "$candidate" ]] || continue
    echo "Removing stale deployment directory: $candidate"
    rm -rf -- "$candidate"
  done
}
release_id="${1:?Missing release ID}"
[[ "$release_id" =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ ]] || exit 2
base=/opt/keynest
release="$base/releases/$release_id"
archive="$base/incoming/$release_id/release.tar.gz"
case "$release" in "$base"/releases/*) ;; *) exit 2 ;; esac
mkdir -p "$base/releases"
exec 9>"$base/deploy.lock"
flock -w 300 9
test -s "$base/.env" || { echo 'Create /opt/keynest/.env first.'; exit 1; }
test ! -e "$release"
previous="$(previous_release "$base")"
# Keep the active release as the rollback target, and discard older copies
# before npm ci needs disk space. If current is invalid, retain all releases.
if [[ -n "$previous" ]]; then
  prune_children "$base/releases" "$previous"
else
  echo 'No valid current release; skipping release pruning.'
fi
prune_children "$base/incoming" "$base/incoming/$release_id"

worker_enabled=false
if systemctl is-enabled --quiet keynest-payments.service; then worker_enabled=true; fi
activated=false
release_created=false
rollback() {
  code=$?
  if [[ "$code" != 0 ]]; then
    if [[ "$activated" == true ]]; then
      if [[ -n "$previous" && -d "$previous" ]]; then
        ln -sfn "$previous" "$base/current.next"
        mv -Tf "$base/current.next" "$base/current"
        sudo -n /usr/bin/systemctl restart keynest || true
        if [[ "$worker_enabled" == true ]]; then sudo -n /usr/bin/systemctl restart keynest-payments || true; fi
        echo 'Deployment failed; previous release restored. Check service logs.'
      else
        sudo -n /usr/bin/systemctl stop keynest || true
        if [[ "$worker_enabled" == true ]]; then sudo -n /usr/bin/systemctl stop keynest-payments || true; fi
        echo 'First deployment failed. Check service logs and .env.'
      fi
    fi
    if [[ "$release_created" == true && -d "$release" && ! -L "$release" ]]; then
      current_now="$(readlink -e "$base/current" 2>/dev/null || true)"
      if [[ "$release" != "$current_now" ]]; then
        echo "Removing failed staging release: $release"
        rm -rf -- "$release"
      fi
    fi
  fi
  exit "$code"
}
trap rollback EXIT
mkdir "$release"
release_created=true
tar -xzf "$archive" -C "$release"
ln -s "$base/.env" "$release/.env"
cd "$release"
# Install Linux binaries (sharp) on the VPS; frontend was built on GitHub.
npm ci --omit=dev --no-audit --no-fund
node --check server/index.js
test -s dist/index.html
ln -sfn "$release" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
activated=true
sudo -n /usr/bin/systemctl restart keynest
if [[ "$worker_enabled" == true ]]; then sudo -n /usr/bin/systemctl restart keynest-payments; fi
for attempt in {1..20}; do
  if curl --fail --silent --max-time 5 http://127.0.0.1:3001/api/health > /dev/null &&
     [[ "$(curl --fail --silent --max-time 5 http://127.0.0.1:3001/release.txt)" == "${release_id:0:40}" ]]; then
    echo "Deployed ${release_id:0:40}"
    prune_children "$base/releases" "$release" "$previous" || echo 'Warning: could not prune old releases.'
    rm -rf -- "$base/incoming/$release_id" 2>/dev/null || echo 'Warning: could not remove uploaded release archive.'
    trap - EXIT
    exit 0
  fi
  sleep 2
done
echo 'Health or release check failed.'
systemctl show keynest -p ActiveState -p SubState -p Result -p ExecMainStatus -p WorkingDirectory || true
echo 'Read startup logs on the VPS: sudo journalctl -u keynest -n 100 --no-pager'
exit 1
