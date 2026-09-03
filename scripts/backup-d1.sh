#!/usr/bin/env bash
# Export a restorable, compressed copy of the production Gauntlet D1 ledger.
# Intended for homelab-pve cron; stdout/stderr are appended to its backup log.

set -euo pipefail
umask 077
PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

REPO_DIR="${GAUNTLET_REPO_DIR:-/root/the-gauntlet}"
BACKUP_DIR="${GAUNTLET_D1_BACKUP_DIR:-/root/vps-backups/gauntlet}"
KEEP="${GAUNTLET_D1_BACKUP_KEEP:-14}"
AUTH_CONFIG="${GAUNTLET_CLOUDFLARE_CONFIG:-/root/.cloudflare/config.json}"
NPX_BIN="${GAUNTLET_NPX_BIN:-npx}"
STAMP="$(date +%F-%H%M)"
SQL_PATH="$BACKUP_DIR/d1-$STAMP.sql"

if ! [[ "$KEEP" =~ ^[1-9][0-9]*$ ]]; then
  echo "GAUNTLET_D1_BACKUP_KEEP must be a positive integer" >&2
  exit 2
fi

# The host's existing Cloudflare token is kept outside the repository. Permit an
# explicitly supplied token (useful for CI/rotation), otherwise reuse that host
# credential without ever printing it.
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" && -r "$AUTH_CONFIG" ]]; then
  export CLOUDFLARE_API_TOKEN
  CLOUDFLARE_API_TOKEN="$(node -e '
    const fs = require("fs");
    const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(config.dns_token || "");
  ' "$AUTH_CONFIG")"
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "Cloudflare token unavailable (set CLOUDFLARE_API_TOKEN or configure $AUTH_CONFIG)" >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR"
trap 'rm -f -- "$SQL_PATH"' EXIT

echo "[$(date -Is)] exporting production D1 ledger to $SQL_PATH"
(
  cd "$REPO_DIR"
  "$NPX_BIN" wrangler d1 export the-gauntlet --remote --output "$SQL_PATH" -y
)

[[ -s "$SQL_PATH" ]] || { echo "D1 export produced an empty snapshot" >&2; exit 1; }
gzip -9 -- "$SQL_PATH"
trap - EXIT

# Retention is count-based rather than mtime-based: a missed night never makes
# the remaining recovery points disappear early. Names are generated above, so
# this glob cannot remove unrelated backups.
mapfile -t snapshots < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'd1-*.sql.gz' -printf '%T@ %p\n' | sort -nr | awk '{print $2}')
if ((${#snapshots[@]} > KEEP)); then
  printf '%s\0' "${snapshots[@]:KEEP}" | xargs -0r rm -f --
fi

SNAPSHOT="$SQL_PATH.gz"
echo "[$(date -Is)] D1 backup complete: $SNAPSHOT ($(du -h "$SNAPSHOT" | cut -f1)); retained ${KEEP} newest snapshots"
