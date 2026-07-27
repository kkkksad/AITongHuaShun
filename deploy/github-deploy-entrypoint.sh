#!/usr/bin/env bash
set -Eeuo pipefail

ORIGINAL_COMMAND="${SSH_ORIGINAL_COMMAND:-}"
if [[ "${ORIGINAL_COMMAND}" =~ ^deploy[[:space:]]([0-9a-f]{40})$ ]]; then
  exec bash /opt/kairos/deploy/update-server.sh "${BASH_REMATCH[1]}"
fi

echo "Rejected deployment command." >&2
exit 64
