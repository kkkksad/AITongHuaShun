#!/usr/bin/env bash
set -Eeuo pipefail

# This installer targets the existing single-host /opt/kairos deployment.
ROOT=/opt/kairos
if [[ "${EUID}" -ne 0 ]]; then
  echo "Run sudo bash deploy/install-paper-history.sh." >&2
  exit 1
fi
id ubuntu >/dev/null
for file in scripts/paper_history.py scripts/paper_history_contract.py scripts/paper_history_read_model.py deploy/kairos-paper-history.service deploy/kairos-paper-history.timer; do
  [[ -s "${ROOT}/${file}" ]] || { echo "Missing archive release source." >&2; exit 1; }
done
[[ -d "${ROOT}/runtime" && ! -L "${ROOT}/runtime" ]] || { echo "Invalid runtime directory." >&2; exit 1; }
archive="${ROOT}/runtime/archive"
if [[ -e "${archive}" || -L "${archive}" ]]; then
  [[ -d "${archive}" && ! -L "${archive}" && "$(stat -c %U "${archive}")" == ubuntu ]] || { echo "Archive directory must be owned by ubuntu and cannot be a link." >&2; exit 1; }
fi
install -d -m 0700 -o ubuntu -g ubuntu "${archive}"
systemd-analyze verify "${ROOT}/deploy/kairos-paper-history.service" "${ROOT}/deploy/kairos-paper-history.timer"
install -m 0644 "${ROOT}/deploy/kairos-paper-history.service" /etc/systemd/system/kairos-paper-history.service
install -m 0644 "${ROOT}/deploy/kairos-paper-history.timer" /etc/systemd/system/kairos-paper-history.timer
systemctl daemon-reload
systemctl enable --now kairos-paper-history.timer
systemctl start kairos-paper-history.service
systemctl is-active --quiet kairos-paper-history.timer
echo "Paper history timer installed; the trading ledger was not modified."
