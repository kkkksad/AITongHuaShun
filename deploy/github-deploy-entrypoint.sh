#!/usr/bin/env bash
set -Eeuo pipefail

ORIGINAL_COMMAND="${SSH_ORIGINAL_COMMAND:-}"
if [[ "${ORIGINAL_COMMAND}" =~ ^deploy[[:space:]]([0-9a-f]{40})$ ]]; then
  exec bash /opt/kairos/deploy/update-server.sh "${BASH_REMATCH[1]}"
fi
if [[ "${ORIGINAL_COMMAND}" =~ ^deploy-upload[[:space:]]([0-9a-f]{40})$ ]]; then
  commit="${BASH_REMATCH[1]}"
  archive="/tmp/kairos-release-${commit}.tar.gz"
  umask 077
  cat >"${archive}"
  exec bash /opt/kairos/deploy/update-server.sh "${commit}"
fi

echo "Rejected deployment command." >&2
exit 64
