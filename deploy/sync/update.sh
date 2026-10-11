#!/usr/bin/env bash
# Neue Images holen und nur dann neu starten, wenn sich eines geändert hat – stündlich per systemd-Timer oder
# jederzeit von Hand. Was passiert ist, steht im Journal: journalctl -u mtgdeck-sync-update.service
set -euo pipefail
cd "$(dirname "$0")"
before=$(docker compose images -q 2>/dev/null | sort)
docker compose pull --quiet
after=$(docker compose images -q 2>/dev/null | sort)
if [ "$before" != "$after" ] || [ "${1:-}" = "--force" ]; then
  docker compose up -d --remove-orphans
  docker image prune -f >/dev/null
  echo "Update eingespielt: $(docker compose ps --format '{{.Service}} {{.Image}}' | tr '\n' ' ')"
else
  echo "Kein Update: alle Images aktuell."
fi
