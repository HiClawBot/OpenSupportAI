#!/bin/sh
set -eu

if [ "${1:-}" = "--help" ]; then
  printf '%s\n' "Usage: configure the production Compose environment, then run scripts/production-compose-smoke.sh"
  exit 0
fi

for command_name in docker curl node; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Required command is unavailable: %s\n' "$command_name" >&2
    exit 1
  fi
done

: "${POSTGRES_USER:=opensupportai}"
: "${POSTGRES_DB:=opensupportai}"
: "${API_PORT:=4400}"
: "${WORKER_HEARTBEAT_STALE_MS:=6000}"
: "${WORKER_HEARTBEAT_MS:=1000}"
: "${COMPOSE_PROJECT_NAME:=opensupportai-beta-smoke-${GITHUB_RUN_ID:-$$}}"

export POSTGRES_USER POSTGRES_DB API_PORT WORKER_HEARTBEAT_STALE_MS WORKER_HEARTBEAT_MS
export COMPOSE_PROJECT_NAME

compose_file="deploy/docker-compose/docker-compose.production.yml"
backup_file="$(mktemp "${TMPDIR:-/tmp}/opensupportai-backup.XXXXXX")"
readiness_body="$(mktemp "${TMPDIR:-/tmp}/opensupportai-readiness.XXXXXX")"
load_report="$(mktemp "${TMPDIR:-/tmp}/opensupportai-load.XXXXXX")"
fault_report="$(mktemp "${TMPDIR:-/tmp}/opensupportai-faults.XXXXXX")"
worker_recovery_state="$(mktemp "${TMPDIR:-/tmp}/opensupportai-worker-recovery.XXXXXX")"
soak_report="$(mktemp "${TMPDIR:-/tmp}/opensupportai-soak.XXXXXX")"

compose() {
  docker compose -f "$compose_file" "$@"
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ "$status" -ne 0 ]; then
    compose ps >&2 || true
    compose logs --no-color api worker migrate postgres >&2 || true
  fi
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -f "$backup_file" "$readiness_body" "$load_report" "$fault_report" "$worker_recovery_state" "$soak_report"
  exit "$status"
}
trap cleanup EXIT INT TERM

wait_for_status() {
  expected_status=$1
  attempts=${2:-90}
  attempt=1
  while [ "$attempt" -le "$attempts" ]; do
    actual_status="$(curl --silent --output "$readiness_body" --write-out '%{http_code}' "http://127.0.0.1:${API_PORT}/health/ready" || true)"
    if [ "$actual_status" = "$expected_status" ]; then
      return 0
    fi
    sleep 2
    attempt=$((attempt + 1))
  done
  printf 'Readiness did not reach HTTP %s; last body:\n' "$expected_status" >&2
  cat "$readiness_body" >&2
  return 1
}

compose config --quiet
compose up --detach --build postgres api worker
wait_for_status 200
grep -q '"status":"ready"' "$readiness_body"
grep -q '"worker":{"status":"ok"}' "$readiness_body"

api_container="$(compose ps --quiet api)"
worker_container="$(compose ps --quiet worker)"
test "$(docker inspect --format '{{.Config.User}}' "$api_container")" = "node"
test "$(docker inspect --format '{{.Config.User}}' "$worker_container")" = "node"

heartbeat_count="$(compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM worker_heartbeats WHERE status = 'ready';")"
test "$heartbeat_count" = "1"

compose run --rm migrate node_modules/.bin/tsx prisma/seed.ts

API_URL="http://127.0.0.1:${API_PORT}" \
  ADMIN_TOKEN="$ADMIN_API_TOKEN" \
  LOAD_CONVERSATIONS="${BETA_LOAD_CONVERSATIONS:-8}" \
  LOAD_CONCURRENCY="${BETA_LOAD_CONCURRENCY:-4}" \
  LOAD_ANSWER_P95_MS="${BETA_LOAD_ANSWER_P95_MS:-60000}" \
  LOAD_REPORT_PATH="$load_report" \
  node scripts/beta-load-smoke.mjs

API_URL="http://127.0.0.1:${API_PORT}" \
  ADMIN_TOKEN="$ADMIN_API_TOKEN" \
  FAULT_REPORT_PATH="$fault_report" \
  node scripts/beta-fault-smoke.mjs

# Restore the deterministic provider after the disposable outage probe.
compose run --rm migrate node_modules/.bin/tsx prisma/seed.ts

compose stop --timeout 15 worker
wait_for_status 503 30
grep -q '"worker_stale"' "$readiness_body"

API_URL="http://127.0.0.1:${API_PORT}" \
  ADMIN_TOKEN="$ADMIN_API_TOKEN" \
  WORKER_RECOVERY_STATE_PATH="$worker_recovery_state" \
  node scripts/beta-worker-recovery.mjs enqueue

compose start worker
wait_for_status 200

API_URL="http://127.0.0.1:${API_PORT}" \
  ADMIN_TOKEN="$ADMIN_API_TOKEN" \
  WORKER_RECOVERY_STATE_PATH="$worker_recovery_state" \
  node scripts/beta-worker-recovery.mjs verify

API_URL="http://127.0.0.1:${API_PORT}" \
  ADMIN_TOKEN="$ADMIN_API_TOKEN" \
  SOAK_DURATION_SECONDS="${BETA_SHORT_SOAK_SECONDS:-12}" \
  SOAK_INTERVAL_MS="${BETA_SHORT_SOAK_INTERVAL_MS:-2000}" \
  SOAK_ANSWER_TIMEOUT_MS="${BETA_SHORT_SOAK_ANSWER_TIMEOUT_MS:-30000}" \
  SOAK_REPORT_PATH="$soak_report" \
  node scripts/beta-soak.mjs

compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges >"$backup_file"
test -s "$backup_file"

restore_database="${POSTGRES_DB}_restore"
compose exec -T postgres createdb -U "$POSTGRES_USER" "$restore_database"
compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$restore_database" --no-owner --no-privileges <"$backup_file"

restored_migration_count="$(compose exec -T postgres psql -U "$POSTGRES_USER" -d "$restore_database" -Atc "SELECT COUNT(*) FROM \"_prisma_migrations\" WHERE migration_name = '202607220003_production_readiness' AND finished_at IS NOT NULL;")"
test "$restored_migration_count" = "1"
compose exec -T postgres psql -U "$POSTGRES_USER" -d "$restore_database" -Atc "SELECT COUNT(*) FROM worker_heartbeats;" >/dev/null

compose run --rm migrate
printf '%s\n' "Production Compose smoke passed: load, provider faults, worker queue recovery, soak harness, backup, restore, and migration replay."
