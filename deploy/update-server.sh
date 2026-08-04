#!/usr/bin/env bash
set -Eeuo pipefail

COMMIT="${1:-}"
ROOT=/opt/kairos
COMPOSE_FILE="${ROOT}/docker-compose.production.yml"
ENV_FILE="${ROOT}/.env.production"
LOCK_FILE=/tmp/kairos-production-deploy.lock
RELEASE_ARCHIVE="/tmp/kairos-release-${COMMIT}.tar.gz"
SOURCE_BACKUP="/tmp/kairos-source-backup-${COMMIT}.tar.gz"
SERVICES=(akshare-bridge backend web)
IMAGES=(kairos-akshare-bridge kairos-api kairos-web)

if [[ ! "${COMMIT}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "A full Git commit SHA is required." >&2
  exit 64
fi

cd "${ROOT}"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "Another production deployment is running." >&2
  exit 75
fi

if [[ ! -s "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}." >&2
  exit 78
fi

compose() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

previous_commit="$(git rev-parse HEAD 2>/dev/null || true)"

replace_source_from_archive() {
  local archive="${1:?archive is required}"
  if [[ ! -s "${archive}" ]]; then
    echo "Missing release archive: ${archive}." >&2
    exit 78
  fi

  tar --exclude='./runtime' --exclude='./.env.production' -czf "${SOURCE_BACKUP}" -C "${ROOT}" . || true
  find "${ROOT}" -mindepth 1 -maxdepth 1 \
    ! -name runtime \
    ! -name .env.production \
    -exec rm -rf {} +
  tar -xzf "${archive}" -C "${ROOT}"
}

restore_source() {
  if [[ -s "${SOURCE_BACKUP}" ]]; then
    find "${ROOT}" -mindepth 1 -maxdepth 1 \
      ! -name runtime \
      ! -name .env.production \
      -exec rm -rf {} +
    tar -xzf "${SOURCE_BACKUP}" -C "${ROOT}"
  elif [[ "${previous_commit}" =~ ^[0-9a-f]{40}$ ]]; then
    git checkout --detach --force "${previous_commit}"
  fi
}

restore_images() {
  local restored=0
  for image in "${IMAGES[@]}"; do
    if docker image inspect "${image}:rollback" >/dev/null 2>&1; then
      docker image tag "${image}:rollback" "${image}:production"
      restored=$((restored + 1))
    fi
  done
  if (( restored == ${#IMAGES[@]} )); then
    compose up -d --no-build --force-recreate --remove-orphans
  else
    echo "No complete rollback image set was available." >&2
  fi
}

for image in "${IMAGES[@]}"; do
  if docker image inspect "${image}:production" >/dev/null 2>&1; then
    docker image tag "${image}:production" "${image}:rollback"
  fi
done

if [[ -s "${RELEASE_ARCHIVE}" ]]; then
  replace_source_from_archive "${RELEASE_ARCHIVE}"
else
  git fetch --no-tags --depth=1 origin "${COMMIT}"
  git checkout --detach --force "${COMMIT}"
fi

if ! compose config --quiet; then
  restore_source
  exit 1
fi

if ! compose build; then
  restore_images
  restore_source
  exit 1
fi

if ! compose up -d --remove-orphans; then
  restore_images
  restore_source
  exit 1
fi

deadline=$((SECONDS + 360))
while (( SECONDS < deadline )); do
  all_healthy=1
  for service in "${SERVICES[@]}"; do
    container_id="$(compose ps -q "${service}")"
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
    if [[ "${health}" != "healthy" ]]; then
      all_healthy=0
      break
    fi
  done
  if (( all_healthy == 1 )) && curl -kfsS https://127.0.0.1/healthz >/dev/null && curl -kfsS https://127.0.0.1/api/health >/dev/null; then
    for image in "${IMAGES[@]}"; do
      docker image rm "${image}:rollback" >/dev/null 2>&1 || true
    done
    rm -f "${RELEASE_ARCHIVE}" "${SOURCE_BACKUP}"
    docker image prune -f --filter "until=168h" >/dev/null
    echo "KAIROS production deployment completed at ${COMMIT}."
    exit 0
  fi
  sleep 10
done

compose logs --tail=200 >&2 || true
restore_images
restore_source
echo "Deployment health check failed; rollback attempted." >&2
exit 1
