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
release_id="${1:?Missing release ID}"
[[ "$release_id" =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ ]] || exit 2
base=/opt/keynest
release="$base/releases/$release_id"
archive="$base/incoming/$release_id/release.tar.gz"
mkdir -p "$base/releases"
exec 9>"$base/deploy.lock"
flock -w 300 9
test -s "$base/.env" || { echo 'Create /opt/keynest/.env first.'; exit 1; }
test ! -e "$release"
mkdir "$release"
tar -xzf "$archive" -C "$release"
ln -s "$base/.env" "$release/.env"
cd "$release"
# Install Linux binaries (sharp) on the VPS; frontend was built on GitHub.
npm ci --omit=dev --no-audit --no-fund
node --check server/index.js
test -s dist/index.html
previous="$(previous_release "$base")"
activated=false
rollback() {
  code=$?
  if [[ "$code" != 0 && "$activated" == true ]]; then
    if [[ -n "$previous" && -d "$previous" ]]; then
      ln -sfn "$previous" "$base/current.next"
      mv -Tf "$base/current.next" "$base/current"
      sudo -n /usr/bin/systemctl restart keynest
      echo 'Deployment failed; previous release restored. Check service logs.'
    else
      sudo -n /usr/bin/systemctl stop keynest
      echo 'First deployment failed. Check service logs and .env.'
    fi
  fi
  exit "$code"
}
trap rollback EXIT
ln -sfn "$release" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
activated=true
sudo -n /usr/bin/systemctl restart keynest
for attempt in {1..20}; do
  if curl --fail --silent --max-time 5 http://127.0.0.1:3001/api/health > /dev/null &&
     [[ "$(curl --fail --silent --max-time 5 http://127.0.0.1:3001/release.txt)" == "${release_id:0:40}" ]]; then
    echo "Deployed ${release_id:0:40}"
    trap - EXIT
    exit 0
  fi
  sleep 2
done
echo 'Health or release check failed.'
systemctl show keynest -p ActiveState -p SubState -p Result -p ExecMainStatus -p WorkingDirectory || true
echo 'Read startup logs on the VPS: sudo journalctl -u keynest -n 100 --no-pager'
exit 1
