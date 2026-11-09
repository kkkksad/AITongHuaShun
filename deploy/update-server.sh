#!/usr/bin/env bash
set -Eeuo pipefail

COMMIT="${1:-}"
ROOT=/opt/kairos
COMPOSE_FILE="${ROOT}/docker-compose.production.yml"
ENV_FILE="${ROOT}/.env.production"
LOCK_FILE=/tmp/kairos-production-deploy.lock
RELEASE_ARCHIVE="/tmp/kairos-release-${COMMIT}.tar.gz"
SOURCE_BACKUP="/tmp/kairos-source-backup-${COMMIT}.tar.gz"
SOURCE_STAGING="/tmp/kairos-source-staging-${COMMIT}"
SERVICES=(akshare-bridge backend web)
IMAGES=(kairos-akshare-bridge kairos-api kairos-web)
proxy_backend_before=""
proxy_container_before=""
proxy_config_changed=0
RETENTION_TOOL_DIR=""
RETENTION_SLOT=""

cleanup_retention_attempt() {
  if [[ -n "${RETENTION_TOOL_DIR}" ]]; then
    if [[ -n "${RETENTION_SLOT}" ]]; then
      python3 "${RETENTION_TOOL_DIR}/release_retention.py" abort --root "${ROOT}" --slot "${RETENTION_SLOT}" || \
        echo "Retained-release attempt cleanup needs attention." >&2
    fi
    rm -rf "${RETENTION_TOOL_DIR}"
  fi
}
trap cleanup_retention_attempt EXIT

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

image_runtime_fingerprint() {
  docker image inspect "${1}" | python3 "${ROOT}/deploy/image_runtime_fingerprint.py"
}

reuse_unchanged_images() {
  local image old_fingerprint new_fingerprint
  # Older release archives have no helper; preserve their standard activation
  # path so that this deployment tool can still deploy a known older release.
  if [[ ! -s "${ROOT}/deploy/image_runtime_fingerprint.py" ]]; then
    echo "Target release has no runtime fingerprint helper; using standard activation."
    return 0
  fi
  for image in "${IMAGES[@]}"; do
    if docker image inspect "${image}:rollback" >/dev/null 2>&1; then
      old_fingerprint="$(image_runtime_fingerprint "${image}:rollback")" || return 1
      new_fingerprint="$(image_runtime_fingerprint "${image}:production")" || return 1
      [[ "${old_fingerprint}" =~ ^[0-9a-f]{64}$ && "${new_fingerprint}" =~ ^[0-9a-f]{64}$ ]] || return 1
      if [[ "${old_fingerprint}" == "${new_fingerprint}" ]]; then
        # Build proof metadata can change an OCI index while its actual runtime
        # is identical. Retain the verified old image and its proof in that case.
        docker image tag "${image}:rollback" "${image}:production" || return 1
        echo "Reusing unchanged runtime image: ${image}"
      fi
    fi
  done
}

capture_proxy_state() {
  local desired_config current_config
  proxy_backend_before="$(compose ps -q backend)" || return 1
  proxy_container_before="$(compose ps -q web)" || return 1
  proxy_config_changed=0
  if [[ -n "${proxy_container_before}" ]]; then
    desired_config="$(sha256sum "${ROOT}/deploy/nginx.conf" | cut -d ' ' -f1)" || return 1
    [[ "${desired_config}" =~ ^[0-9a-f]{64}$ ]] || return 1
    current_config="$(docker exec "${proxy_container_before}" sha256sum /etc/nginx/conf.d/default.conf | cut -d ' ' -f1)" || current_config=""
    if [[ "${desired_config}" != "${current_config}" ]]; then
      proxy_config_changed=1
    fi
  fi
}

refresh_retained_proxy() {
  local backend_after proxy_after
  [[ -n "${proxy_container_before}" ]] || return 0
  backend_after="$(compose ps -q backend)" || return 1
  proxy_after="$(compose ps -q web)" || return 1
  if [[ "${proxy_after}" == "${proxy_container_before}" &&
        ( "${backend_after}" != "${proxy_backend_before}" || "${proxy_config_changed}" == 1 ) ]]; then
    # Nginx resolves literal upstream names at startup. A recreated backend may
    # get a different address, and a retained single-file bind keeps its old inode.
    compose up -d --no-deps --force-recreate web || return 1
    echo "Refreshed reverse proxy after upstream or mounted configuration changed."
  fi
}

# The ACME webroot is a host bind mount. Create it as the deployment user
# before Compose can silently create a root-owned directory for the container.
prepare_acme_runtime() {
  local acme="${ROOT}/runtime/acme"
  local path
  for path in "${acme}" "${acme}/config" "${acme}/work" "${acme}/logs" "${acme}/webroot" "${acme}/webroot/.well-known" "${acme}/webroot/.well-known/acme-challenge"; do
    if [[ -e "${path}" || -L "${path}" ]]; then
      [[ -d "${path}" && ! -L "${path}" && -O "${path}" ]] || { echo "ACME runtime path is not owned by the deployment user. Fix ownership before retrying." >&2; exit 1; }
    fi
  done
  install -d -m 0700 "${acme}" "${acme}/config" "${acme}/work" "${acme}/logs"
  install -d -m 0755 "${acme}/webroot" "${acme}/webroot/.well-known" "${acme}/webroot/.well-known/acme-challenge"
  for path in "${acme}" "${acme}/config" "${acme}/work" "${acme}/logs" "${acme}/webroot"; do
    [[ -O "${path}" ]] || { echo "ACME runtime path is not owned by the deployment user: ${path}. Fix ownership before retrying." >&2; exit 1; }
  done
}

# Use the currently installed helper before staging, source backup, image builds,
# or container changes. An older target archive need not contain this helper.
if [[ -e "${ROOT}/deploy/deployment_capacity.py" || -L "${ROOT}/deploy/deployment_capacity.py" ]]; then
  [[ -f "${ROOT}/deploy/deployment_capacity.py" && ! -L "${ROOT}/deploy/deployment_capacity.py" && -s "${ROOT}/deploy/deployment_capacity.py" ]] || {
    echo "Installed deployment capacity helper is unsafe or empty; current source is preserved." >&2
    exit 78
  }
  python3 "${ROOT}/deploy/deployment_capacity.py" --root "${ROOT}" || exit 75
else
  echo "Installed release has no capacity helper; using legacy deployment path."
fi

prepare_archive_read_model_runtime() {
  local path
  for path in "${ROOT}/runtime" "${ROOT}/runtime/archive" "${ROOT}/runtime/archive/read-model"; do
    if [[ -e "${path}" || -L "${path}" ]]; then
      [[ -d "${path}" && ! -L "${path}" && -O "${path}" ]] || {
        echo "Archive read-model path must be owned by the deployment user and cannot be a link." >&2
        exit 78
      }
    fi
  done
  install -d -m 0700 "${ROOT}/runtime/archive" "${ROOT}/runtime/archive/read-model"
}

prepare_archive_read_model_runtime
prepare_acme_runtime

previous_commit="$(git rev-parse HEAD 2>/dev/null || true)"

# Keep the running tool stable while the new archive replaces deploy/ underneath it.
# The first install uses the older updater; retention begins on its next release.
if [[ -s "${ROOT}/deploy/release_retention.py" ]]; then
  RETENTION_TOOL_DIR="$(mktemp -d /tmp/kairos-release-tools-XXXXXX)"
  cp "${ROOT}/deploy/release_retention.py" "${ROOT}/deploy/image_runtime_fingerprint.py" "${RETENTION_TOOL_DIR}/"
fi

replace_source_from_archive() {
  local archive="${1:?archive is required}"
  local required
  if [[ ! -s "${archive}" ]]; then
    echo "Missing release archive: ${archive}." >&2
    exit 78
  fi

  rm -rf "${SOURCE_STAGING}"
  install -d -m 0700 "${SOURCE_STAGING}"
  if ! tar -xzf "${archive}" -C "${SOURCE_STAGING}"; then
    rm -rf "${SOURCE_STAGING}"
    echo "Invalid release archive: ${archive}." >&2
    exit 78
  fi
  for required in \
    Dockerfile \
    docker-compose.production.yml \
    package.json \
    deploy/nginx.conf \
    deploy/github-deploy-entrypoint.sh \
    deploy/update-server.sh; do
    if [[ ! -s "${SOURCE_STAGING}/${required}" ]]; then
      rm -rf "${SOURCE_STAGING}"
      echo "Release archive is missing ${required}." >&2
      exit 78
    fi
  done

  if ! tar --exclude='./runtime' --exclude='./.env.production' -czf "${SOURCE_BACKUP}" -C "${ROOT}" .; then
    rm -rf "${SOURCE_STAGING}"
    echo "Could not back up the current production source." >&2
    exit 1
  fi
  if [[ -n "${RETENTION_TOOL_DIR}" ]]; then
    if ! RETENTION_SLOT="$(python3 "${RETENTION_TOOL_DIR}/release_retention.py" stage --root "${ROOT}" --commit "${COMMIT}")"; then
      echo "Could not retain the matching healthy source/image set; current source is preserved." >&2
      exit 1
    fi
  fi
  find "${ROOT}" -mindepth 1 -maxdepth 1 \
    ! -name runtime \
    ! -name .env.production \
    -exec rm -rf {} +
  if ! cp -a "${SOURCE_STAGING}/." "${ROOT}/"; then
    rm -rf "${SOURCE_STAGING}"
    restore_source
    echo "Could not install the staged production source; restore attempted." >&2
    exit 1
  fi
  rm -rf "${SOURCE_STAGING}"
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
  restore_source
  restore_images
  exit 1
fi

if ! reuse_unchanged_images; then
  restore_source
  restore_images
  echo "Image runtime verification failed; rollback attempted." >&2
  exit 1
fi

if ! capture_proxy_state; then
  restore_source
  restore_images
  echo "Could not verify reverse proxy state; rollback attempted." >&2
  exit 1
fi

if ! compose up -d --remove-orphans; then
  restore_source
  restore_images
  exit 1
fi

if ! refresh_retained_proxy; then
  restore_source
  restore_images
  echo "Reverse proxy refresh failed; rollback attempted." >&2
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
    if [[ -n "${RETENTION_SLOT}" ]]; then
      if ! python3 "${RETENTION_TOOL_DIR}/release_retention.py" promote --root "${ROOT}" --slot "${RETENTION_SLOT}" --commit "${COMMIT}"; then
        restore_source
        restore_images
        echo "Could not commit retained release assets; rollback attempted." >&2
        exit 1
      fi
      RETENTION_SLOT=""
    fi
    for image in "${IMAGES[@]}"; do
      docker image rm "${image}:rollback" >/dev/null 2>&1 || true
    done
    rm -rf "${SOURCE_STAGING}"
    rm -f "${RELEASE_ARCHIVE}" "${SOURCE_BACKUP}"
    # Host-wide dangling-image pruning cannot prove application ownership.
    # Retained slots manage only their own exact tags; cache maintenance is separate.
    echo "KAIROS production deployment completed at ${COMMIT}."
    exit 0
  fi
  sleep 10
done

compose logs --tail=200 >&2 || true
restore_source
restore_images
echo "Deployment health check failed; rollback attempted." >&2
exit 1
