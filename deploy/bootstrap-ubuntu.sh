#!/usr/bin/env bash
set -Eeuo pipefail

PUBLIC_HOST="${1:?Usage: sudo bash deploy/bootstrap-ubuntu.sh <public-ip-or-domain>}"
DEPLOY_USER="${SUDO_USER:-ubuntu}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl docker.io docker-compose-v2 openssl
systemctl enable --now docker
usermod -aG docker "${DEPLOY_USER}"

install -d -m 0750 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" /opt/kairos
install -d -m 0750 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" /opt/kairos/runtime
install -d -m 0750 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" /opt/kairos/runtime/data
install -d -m 0750 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" /opt/kairos/runtime/logs
install -d -m 0750 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" /opt/kairos/runtime/certs

CERT_DIR=/opt/kairos/runtime/certs
if [[ ! -s "${CERT_DIR}/kairos.crt" || ! -s "${CERT_DIR}/kairos.key" ]]; then
  SAN_KIND=DNS
  if [[ "${PUBLIC_HOST}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    SAN_KIND=IP
  fi
  openssl req -x509 -nodes -newkey rsa:3072 -sha256 -days 365 \
    -keyout "${CERT_DIR}/kairos.key" \
    -out "${CERT_DIR}/kairos.crt" \
    -subj "/CN=${PUBLIC_HOST}" \
    -addext "subjectAltName=${SAN_KIND}:${PUBLIC_HOST}" \
    -addext "keyUsage=digitalSignature,keyEncipherment" \
    -addext "extendedKeyUsage=serverAuth"
  chmod 0600 "${CERT_DIR}/kairos.key"
  chmod 0644 "${CERT_DIR}/kairos.crt"
fi

chown -R "${DEPLOY_USER}:${DEPLOY_USER}" /opt/kairos/runtime
docker --version
docker compose version
