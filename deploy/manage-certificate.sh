#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
AGREEMENT_URL=https://letsencrypt.org/documents/LE-SA-v1.8-July-06-2026.pdf
ACME_DIRECTORY=https://acme-v02.api.letsencrypt.org/directory
# Official release: https://github.com/certbot/certbot/releases/tag/v5.9.0
# Registry digest lookup was unavailable; pin the verified release tag rather
# than latest. Operators may supply a separately verified immutable digest.
CERTBOT_IMAGE="${KAIROS_CERTBOT_IMAGE:-certbot/certbot:v5.9.0}"
LOCK_FILE="${KAIROS_DEPLOY_LOCK_FILE:-/tmp/kairos-production-deploy.lock}"
CERT_DIR="${ROOT}/runtime/certs"
STATE_DIR="${ROOT}/runtime/acme"
WEBROOT="${STATE_DIR}/webroot"
ACTIVE=.acme-current
action= domain= accepted_agreement= dry_run=0
domains=()
probe_file= rollback_pending=0 backup_name=

usage() {
  cat <<EOF
Usage: bash deploy/manage-certificate.sh issue|renew --domain DOMAIN [--domain ALT_DOMAIN ...] [options]
  --accept-subscriber-agreement URL
      Explicitly confirm the operator has accepted this reviewed agreement:
      ${AGREEMENT_URL}
      Required for every real issue/renew run; never accepted by default.
  --dry-run  Print the local plan only: no commands, writes or CA requests.
  --help     Show this help without making changes.

Uses the official Certbot Docker image (KAIROS_CERTBOT_IMAGE may pin a digest).
Run as the non-root owner of this deployment (ubuntu), never with sudo.
Account keys and renewal state stay in runtime/acme; only webroot is served.
No email is registered. This script does not install a scheduler.
Deploy the ACME Nginx/Compose webroot mount before a real issue/renew run.
Existing runtime/certs/kairos.crt and kairos.key are required and preserved
until the replacement chain, hostname, expiry and private key pass validation.
EOF
}

fail() { printf '%s\n' "$1" >&2; exit "${2:-1}"; }
require_value() { [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || fail 'Missing option value. See --help.' 64; }

while (( $# )); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    issue|renew) [[ -z "$action" ]] || fail 'Only one action is allowed.' 64; action="$1"; shift ;;
    --domain) require_value "$@"; domains+=("$2"); shift 2 ;;
    --accept-subscriber-agreement) require_value "$@"; accepted_agreement="$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    *) fail 'Unknown action or option. See --help.' 64 ;;
  esac
done

[[ "$action" == issue || "$action" == renew ]] || fail 'Choose issue or renew. See --help.' 64
(( ${#domains[@]} > 0 )) || fail 'At least one --domain is required. See --help.' 64
for domain_value in "${domains[@]}"; do
  [[ ${#domain_value} -le 253 && "$domain_value" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ && ! "$domain_value" =~ ^[0-9]+(\.[0-9]+){3}$ ]] || fail 'A lowercase DNS domain is required; IPs and wildcards are unsupported.' 64
  IFS=. read -r -a labels <<< "$domain_value"
  for label in "${labels[@]}"; do [[ ${#label} -le 63 ]] || fail 'DNS label is too long.' 64; done
done
unique_domains=()
for domain_value in "${domains[@]}"; do
  duplicate=0
  for existing in "${unique_domains[@]}"; do [[ "$existing" != "$domain_value" ]] || duplicate=1; done
  (( duplicate )) || unique_domains+=("$domain_value")
done
domains=("${unique_domains[@]}")
domain="${domains[0]}"
[[ -z "$accepted_agreement" || "$accepted_agreement" == "$AGREEMENT_URL" ]] || fail 'Agreement URL does not match the reviewed version. See --help.' 64
if (( dry_run )); then
  printf 'DRY RUN: no commands, writes or CA requests.\nAction: %s\nDomains: %s\nAgreement required for execution: %s\n' "$action" "${domains[*]}" "$AGREEMENT_URL"
  printf 'Plan: verify webroot; check current CA terms; run Certbot; validate certificate; atomically switch certificate pair; nginx -t and reload (rollback on failure).\n'
  exit 0
fi
[[ "$accepted_agreement" == "$AGREEMENT_URL" ]] || fail 'Explicit --accept-subscriber-agreement URL is required. No agreement has been accepted.' 64
[[ "$EUID" -ne 0 ]] || fail 'Run as the non-root deployment owner (ubuntu), without sudo; the deployment lock must retain that owner.'
[[ -O "$ROOT" && -O "${ROOT}/runtime" && -O "$CERT_DIR" ]] || fail 'Deployment root, runtime and certificate directory must belong to the current deployment user.'
[[ -w "$CERT_DIR" && -r "${CERT_DIR}/kairos.crt" && -r "${CERT_DIR}/kairos.key" ]] || fail 'The deployment user must be able to read and replace its certificate pair.'
for runtime_path in "$STATE_DIR" "${STATE_DIR}/config" "${STATE_DIR}/work" "${STATE_DIR}/logs" "$WEBROOT" "${WEBROOT}/.well-known" "${WEBROOT}/.well-known/acme-challenge"; do
  if [[ -e "$runtime_path" || -L "$runtime_path" ]]; then
    [[ -d "$runtime_path" && ! -L "$runtime_path" && -O "$runtime_path" && -w "$runtime_path" ]] || fail 'ACME runtime paths must be writable directories owned by the deployment user; fix ownership before retrying.'
  fi
done
[[ -s "${CERT_DIR}/kairos.crt" && -s "${CERT_DIR}/kairos.key" ]] || fail 'Existing certificate pair is required; bootstrap the deployment first.'
if [[ "$action" == renew ]]; then
  [[ -s "${STATE_DIR}/config/renewal/${domain}.conf" ]] || fail 'No existing renewal lineage for this domain; use issue first.'
fi
for tool in docker curl python3 openssl flock mktemp install cmp; do
  command -v "$tool" >/dev/null || fail "Missing required tool: ${tool}"
done

# Serialize with the existing application deployment entrypoint.
if [[ -e "$LOCK_FILE" || -L "$LOCK_FILE" ]]; then
  [[ -f "$LOCK_FILE" && ! -L "$LOCK_FILE" && -O "$LOCK_FILE" && -w "$LOCK_FILE" ]] || fail 'The shared deployment lock must be a writable regular file owned by the deployment user.'
fi
exec 9>>"$LOCK_FILE"
chmod 0600 "$LOCK_FILE"
flock -n 9 || fail 'Another deployment or certificate operation is running.'

compose() {
  docker compose --project-directory "$ROOT" --env-file "${ROOT}/.env.production" \
    -f "${ROOT}/docker-compose.production.yml" "$@"
}
atomic_link() {
  local target="$1" destination="$2" temporary="${CERT_DIR}/.acme-link.$$.$RANDOM"
  ln -s -- "$target" "$temporary"
  mv -Tf -- "$temporary" "$destination"
}
on_exit() {
  local status=$?
  trap - EXIT
  if (( rollback_pending )); then
    printf 'Certificate activation failed; restoring the previous pair.\n' >&2
    if atomic_link "$backup_name" "${CERT_DIR}/${ACTIVE}" &&
       atomic_link "${ACTIVE}/fullchain.pem" "${CERT_DIR}/kairos.crt" &&
       atomic_link "${ACTIVE}/privkey.pem" "${CERT_DIR}/kairos.key" &&
       compose exec -T web nginx -t && compose exec -T web nginx -s reload; then
      printf 'Previous certificate pair restored.\n' >&2
    else
      printf 'Certificate rollback requires operator attention; the previous pair remains in the certificate backup directory.\n' >&2
    fi
  fi
  if [[ -n "$probe_file" ]]; then rm -f -- "$probe_file"; fi
  exit "$status"
}
trap on_exit EXIT

# Compare the live directory's legal version before passing --agree-tos to
# Certbot. A later terms change stops unattended renewals for human review.
current_agreement="$(curl --proto '=https' --tlsv1.2 -fsS --max-time 15 "$ACME_DIRECTORY" |
  python3 -c 'import json,sys; print(json.load(sys.stdin).get("meta", {}).get("termsOfService", ""))')"
[[ "$current_agreement" == "$accepted_agreement" ]] || fail 'The CA agreement has changed or is unavailable. Review its current terms before retrying.'

install -d -m 0700 "$STATE_DIR" "${STATE_DIR}/config" "${STATE_DIR}/work" "${STATE_DIR}/logs"
install -d -m 0755 "$WEBROOT" "${WEBROOT}/.well-known" "${WEBROOT}/.well-known/acme-challenge"
compose exec -T web nginx -t
probe="kairos-acme-$$-$RANDOM"
probe_file="${WEBROOT}/.well-known/acme-challenge/${probe}"
printf '%s' "$probe" > "$probe_file"
chmod 0644 "$probe_file"
served_probe="$(compose exec -T web wget -q -O - "http://127.0.0.1/.well-known/acme-challenge/${probe}")"
[[ "$served_probe" == "$probe" ]] || fail 'ACME webroot is not served by the running web container. Deploy its Nginx/Compose support first.'
rm -f -- "$probe_file"
probe_file=

certbot_args=(--non-interactive --agree-tos --server "$ACME_DIRECTORY" --no-directory-hooks)
if [[ "$action" == issue ]]; then
  certbot_args=(certonly "${certbot_args[@]}" --webroot --webroot-path /var/www/acme \
    --cert-name "$domain")
  for domain_value in "${domains[@]}"; do certbot_args+=(--domain "$domain_value"); done
  certbot_args+=(--keep-until-expiring --register-unsafely-without-email)
else
  certbot_args=(renew "${certbot_args[@]}" --cert-name "$domain" --no-random-sleep-on-renew)
fi
docker run --rm --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges:true \
  -v "${STATE_DIR}/config:/etc/letsencrypt" -v "${STATE_DIR}/work:/var/lib/letsencrypt" \
  -v "${STATE_DIR}/logs:/var/log/letsencrypt" -v "${WEBROOT}:/var/www/acme" \
  "$CERTBOT_IMAGE" "${certbot_args[@]}"

source_cert="${STATE_DIR}/config/live/${domain}/fullchain.pem"
source_key="${STATE_DIR}/config/live/${domain}/privkey.pem"
[[ -s "$source_cert" && -s "$source_key" ]] || fail 'Certbot did not produce a complete certificate pair.'
for domain_value in "${domains[@]}"; do
  openssl x509 -in "$source_cert" -noout -checkhost "$domain_value" >/dev/null
done
openssl x509 -in "$source_cert" -noout -checkend 86400 >/dev/null
openssl verify -purpose sslserver -CApath /etc/ssl/certs -untrusted "$source_cert" "$source_cert" >/dev/null
certificate_key="$(openssl x509 -in "$source_cert" -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256)"
private_key="$(openssl pkey -in "$source_key" -passin pass: -pubout -outform DER | openssl dgst -sha256)"
[[ "$certificate_key" == "$private_key" ]] || fail 'Certificate and private key do not match.'
if cmp -s "$source_cert" "${CERT_DIR}/kairos.crt" && cmp -s "$source_key" "${CERT_DIR}/kairos.key"; then
  printf 'Certificate pair is unchanged; no activation or reload needed.\n'
  exit 0
fi

if [[ -L "${CERT_DIR}/kairos.crt" || -L "${CERT_DIR}/kairos.key" || -e "${CERT_DIR}/${ACTIVE}" || -L "${CERT_DIR}/${ACTIVE}" ]]; then
  [[ -L "${CERT_DIR}/${ACTIVE}" && "$(readlink "${CERT_DIR}/kairos.crt")" == "${ACTIVE}/fullchain.pem" && "$(readlink "${CERT_DIR}/kairos.key")" == "${ACTIVE}/privkey.pem" ]] || fail 'Existing certificate symlinks are not managed by this script; manual review is required.'
fi

# The stable Nginx paths point through ONE directory link, so activating a
# generation changes the certificate and key together. Preserve the old pair.
backup_dir="$(mktemp -d "${CERT_DIR}/.acme-pair.XXXXXXXX")"
chmod 0750 "$backup_dir"
install -m 0644 "${CERT_DIR}/kairos.crt" "${backup_dir}/fullchain.pem"
install -m 0600 "${CERT_DIR}/kairos.key" "${backup_dir}/privkey.pem"
backup_name="${backup_dir##*/}"
candidate_dir="$(mktemp -d "${CERT_DIR}/.acme-pair.XXXXXXXX")"
chmod 0750 "$candidate_dir"
install -m 0644 "$source_cert" "${candidate_dir}/fullchain.pem"
install -m 0600 "$source_key" "${candidate_dir}/privkey.pem"
rollback_pending=1
atomic_link "$backup_name" "${CERT_DIR}/${ACTIVE}"
atomic_link "${ACTIVE}/fullchain.pem" "${CERT_DIR}/kairos.crt"
atomic_link "${ACTIVE}/privkey.pem" "${CERT_DIR}/kairos.key"
atomic_link "${candidate_dir##*/}" "${CERT_DIR}/${ACTIVE}"
compose exec -T web nginx -t
compose exec -T web nginx -s reload
rollback_pending=0
printf 'Validated certificate pair installed and Nginx reloaded. Previous pair retained locally.\n'
