import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

const deployDir = path.dirname(fileURLToPath(import.meta.url));
const bash = process.env.BASH_BIN || (process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash");
const terms = "https://letsencrypt.org/documents/LE-SA-v1.8-July-06-2026.pdf";
const roots = [];
const unixPath = (value) => process.platform === "win32" ? value.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`).replaceAll("\\", "/") : value;

afterEach(() => {
  for (const root of roots.splice(0)) {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("kairos-acme-test-"));
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(env = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "kairos-acme-test-"));
  roots.push(root);
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  mkdirSync(path.join(root, "deploy"));
  mkdirSync(path.join(root, "runtime/certs"), { recursive: true });
  copyFileSync(path.join(deployDir, "manage-certificate.sh"), path.join(root, "deploy/manage-certificate.sh"));
  writeFileSync(path.join(root, "runtime/certs/kairos.crt"), "OLD CERT\n");
  writeFileSync(path.join(root, "runtime/certs/kairos.key"), "OLD KEY\n");
  writeFileSync(path.join(root, ".env.production"), "TEST_ONLY=true\n");
  writeFileSync(path.join(root, "docker-compose.production.yml"), "name: fixture\n");
  const mocks = {
    curl: 'printf "curl\\n" >> "$TEST_LOG"; printf "{}"',
    python3: 'cat >/dev/null; printf "%s\\n" "$TEST_TERMS"',
    flock: 'printf "flock\\n" >> "$TEST_LOG"; [[ "${TEST_LOCK_BUSY:-0}" == 0 ]]',
    docker: `
printf 'docker %s\\n' "$*" >> "$TEST_LOG"
if [[ "$1" == run ]]; then
  [[ "\${TEST_CERTBOT_FAIL:-0}" == 0 ]] || exit 1
  live="$TEST_ROOT/runtime/acme/config/live/kairosq.cn"
  mkdir -p "$live"
  if [[ "\${TEST_UNCHANGED:-0}" == 1 ]]; then value=OLD; else value=NEW; fi
  printf '%s CERT\\n' "$value" > "$live/fullchain.pem"
  printf '%s KEY\\n' "$value" > "$live/privkey.pem"
elif [[ "$*" == *wget* ]]; then
  [[ "\${TEST_BAD_ROUTE:-0}" == 0 ]] || { printf 'SPA'; exit 0; }
  url="\${@: -1}"; printf '%s' "\${url##*/}"
elif [[ "$*" == *'nginx -t'* && "\${TEST_NGINX_FAIL:-0}" == 1 && "$(cat "$TEST_ROOT/runtime/certs/kairos.crt")" == 'NEW CERT' ]]; then
  exit 1
elif [[ "$*" == *'nginx -s reload'* && "\${TEST_RELOAD_FAIL:-0}" == 1 && "$(cat "$TEST_ROOT/runtime/certs/kairos.crt")" == 'NEW CERT' ]]; then
  exit 1
fi`,
    openssl: `
printf 'openssl %s\\n' "$*" >> "$TEST_LOG"
if [[ "$1" == dgst ]]; then cat
elif [[ "$*" == *'-checkhost'* && "\${TEST_BAD_HOST:-0}" == 1 ]]; then exit 1
elif [[ "$*" == *'-checkhost www.kairosq.cn'* && "\${TEST_BAD_ALIAS:-0}" == 1 ]]; then exit 1
elif [[ "$*" == *'-checkend'* && "\${TEST_EXPIRED:-0}" == 1 ]]; then exit 1
elif [[ "$1" == verify && "\${TEST_BAD_CHAIN:-0}" == 1 ]]; then exit 1
elif [[ "$1" == x509 && "$*" == *'-pubkey'* ]]; then printf 'PUBLIC KEY'
elif [[ "$1" == pkey ]]; then
  if [[ "$*" == *'-pubin'* ]]; then cat >/dev/null; printf 'PUBLIC KEY'
  elif [[ "\${TEST_BAD_KEY:-0}" == 1 ]]; then printf 'DIFFERENT PUBLIC KEY'
  else printf 'PUBLIC KEY'; fi
fi`,
  };
  for (const [name, script] of Object.entries(mocks)) {
    const target = path.join(bin, name);
    writeFileSync(target, `#!/usr/bin/env bash\nset -eu\n${script}\n`);
    chmodSync(target, 0o755);
  }
  const log = path.join(root, "commands.log");
  const run = (args) => spawnSync(bash, [unixPath(path.join(root, "deploy/manage-certificate.sh")), ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, KAIROS_DEPLOY_LOCK_FILE: unixPath(path.join(root, "deployment.lock")), TEST_ROOT: unixPath(root), TEST_LOG: unixPath(log), TEST_TERMS: env.TEST_TERMS || terms },
  });
  return {
    root,
    run,
    log: () => existsSync(log) ? readFileSync(log, "utf8") : "",
    cert: () => readFileSync(path.join(root, "runtime/certs/kairos.crt"), "utf8"),
    key: () => readFileSync(path.join(root, "runtime/certs/kairos.key"), "utf8"),
  };
}

const issueArgs = ["issue", "--domain", "kairosq.cn", "--accept-subscriber-agreement", terms];

test("help names the exact agreement and runs no external command", () => {
  const f = fixture();
  const result = f.run(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /LE-SA-v1\.8-July-06-2026\.pdf/);
  assert.equal(f.log(), "");
});

test("refuses root before creating locks, directories or contacting a CA", { skip: process.getuid?.() !== 0 }, () => {
  const f = fixture();
  assert.notEqual(f.run(issueArgs).status, 0);
  assert.equal(f.log(), "");
  assert.equal(existsSync(path.join(f.root, "deployment.lock")), false);
  assert.equal(existsSync(path.join(f.root, "runtime/acme")), false);
});

test("dry-run needs no agreement and changes no runtime files or network", () => {
  const f = fixture();
  const before = readdirSync(path.join(f.root, "runtime"));
  const result = f.run(["issue", "--domain", "kairosq.cn", "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no commands, writes or CA requests/i);
  assert.equal(f.log(), "");
  assert.deepEqual(readdirSync(path.join(f.root, "runtime")), before);
  assert.equal(f.cert(), "OLD CERT\n");
});

test("actual issuance requires explicit acceptance before Docker, network or writes", () => {
  const f = fixture();
  const result = f.run(["issue", "--domain", "kairosq.cn"]);
  assert.equal(result.status, 64);
  assert.equal(f.log(), "");
  assert.equal(existsSync(path.join(f.root, "runtime/acme")), false);
});

test("dry-run validates and deduplicates every domain without accepting terms", () => {
  const f = fixture();
  const result = f.run(["issue", "--domain", "kairosq.cn", "--domain", "www.kairosq.cn", "--domain", "kairosq.cn", "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Domains: kairosq\.cn www\.kairosq\.cn\n/);
  assert.equal(f.log(), "");
});

test("rejects unknown, missing and unsafe arguments without invoking commands", () => {
  const f = fixture();
  for (const args of [[], ["unexpected"], ["issue", "--domain"], ["issue", "--domain", "../secret"], ["issue", "--domain", "124.221.165.45"], ["issue", "--domain", "kairosq.cn", "--accept-subscriber-agreement"], [...issueArgs, "--surprise"], ["issue", "--domain", "kairosq.cn", "--accept-subscriber-agreement", "unreviewed"], [...issueArgs, "--domain", "*.kairosq.cn"], [...issueArgs, "--domain", "WWW.kairosq.cn"], [...issueArgs, "--domain", "bad..cn"]]) {
    assert.equal(f.run(args).status, 64, JSON.stringify(args));
  }
  assert.equal(f.log(), "");
});

test("refuses linked ACME directories before network access", () => {
  const f = fixture();
  mkdirSync(path.join(f.root, "redirected"));
  symlinkSync("../redirected", path.join(f.root, "runtime/acme"));
  assert.notEqual(f.run(issueArgs).status, 0);
  assert.equal(f.log(), "");
});

test("refuses linked shared locks before network access", () => {
  const f = fixture();
  writeFileSync(path.join(f.root, "other.lock"), "preserve");
  symlinkSync("other.lock", path.join(f.root, "deployment.lock"));
  assert.notEqual(f.run(issueArgs).status, 0);
  assert.equal(readFileSync(path.join(f.root, "other.lock"), "utf8"), "preserve");
  assert.equal(f.log(), "");
});

test("a busy deployment lock stops before CA access without truncating it", () => {
  const f = fixture({ TEST_LOCK_BUSY: "1" });
  writeFileSync(path.join(f.root, "deployment.lock"), "preserve");
  assert.notEqual(f.run(issueArgs).status, 0);
  assert.equal(readFileSync(path.join(f.root, "deployment.lock"), "utf8"), "preserve");
  assert.equal(f.log(), "flock\n");
});

test("refuses a changed CA agreement before running Certbot", () => {
  const f = fixture({ TEST_TERMS: "https://example.test/new-terms.pdf" });
  const result = f.run(issueArgs);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(f.log(), /docker run/);
  assert.equal(f.cert(), "OLD CERT\n");
  assert.equal(f.key(), "OLD KEY\n");
});

test("refuses a missing webroot mapping before running Certbot", () => {
  const f = fixture({ TEST_BAD_ROUTE: "1" });
  assert.notEqual(f.run(issueArgs).status, 0);
  assert.doesNotMatch(f.log(), /docker run/);
  assert.equal(f.cert(), "OLD CERT\n");
});

for (const [name, env] of [
  ["Certbot failure", { TEST_CERTBOT_FAIL: "1" }],
  ["wrong hostname", { TEST_BAD_HOST: "1" }],
  ["expired certificate", { TEST_EXPIRED: "1" }],
  ["untrusted chain", { TEST_BAD_CHAIN: "1" }],
  ["mismatched private key", { TEST_BAD_KEY: "1" }],
  ["Nginx validation failure", { TEST_NGINX_FAIL: "1" }],
  ["Nginx reload failure", { TEST_RELOAD_FAIL: "1" }],
]) {
  test(`${name} preserves the previous certificate pair`, () => {
    const f = fixture(env);
    const result = f.run(issueArgs);
    assert.notEqual(result.status, 0, result.stdout);
    assert.equal(f.cert(), "OLD CERT\n");
    assert.equal(f.key(), "OLD KEY\n");
  });
}

test("installs a validated pair through one version pointer and can renew it", () => {
  const f = fixture();
  const first = f.run(issueArgs);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(f.cert(), "NEW CERT\n");
  assert.equal(f.key(), "NEW KEY\n");
  assert.equal(lstatSync(path.join(f.root, "runtime/certs/kairos.crt")).isSymbolicLink(), true);
  assert.equal(lstatSync(path.join(f.root, "runtime/certs/kairos.key")).isSymbolicLink(), true);
  assert.equal(readlinkSync(path.join(f.root, "runtime/certs/kairos.crt")), ".acme-current/fullchain.pem");
  assert.equal(readlinkSync(path.join(f.root, "runtime/certs/kairos.key")), ".acme-current/privkey.pem");
  assert.equal(readFileSync(path.join(f.root, "runtime/certs/.acme-current/fullchain.pem"), "utf8"), "NEW CERT\n");
  assert.equal(statSync(path.join(f.root, "runtime/certs/.acme-current/privkey.pem")).mode & 0o777, 0o600);
  assert.equal(statSync(path.join(f.root, "runtime/certs/.acme-current/fullchain.pem")).mode & 0o777, 0o644);
  assert.equal(statSync(path.join(f.root, "runtime/certs/.acme-current")).mode & 0o777, 0o750);
  assert.equal(statSync(path.join(f.root, "runtime/acme/config")).mode & 0o777, 0o700);
  assert.equal(statSync(path.join(f.root, "runtime/acme/webroot")).mode & 0o777, 0o755);
  assert.equal(statSync(path.join(f.root, "deployment.lock")).uid, process.getuid());
  assert.equal(statSync(path.join(f.root, "deployment.lock")).mode & 0o777, 0o600);
  const generations = readdirSync(path.join(f.root, "runtime/certs")).filter((name) => name.startsWith(".acme-pair."));
  assert.ok(generations.some((name) => readFileSync(path.join(f.root, "runtime/certs", name, "fullchain.pem"), "utf8") === "OLD CERT\n"));
  assert.match(f.log(), /certonly .*--agree-tos/);
  assert.doesNotMatch(f.log(), /--force-renewal/);
  mkdirSync(path.join(f.root, "runtime/acme/config/renewal"), { recursive: true });
  writeFileSync(path.join(f.root, "runtime/acme/config/renewal/kairosq.cn.conf"), "fixture");
  const renewed = f.run(["renew", ...issueArgs.slice(1)]);
  assert.equal(renewed.status, 0, renewed.stderr);
  assert.match(f.log(), /renew .*--cert-name kairosq\.cn/);
});

test("requests and validates all explicitly supplied hostnames in one lineage", () => {
  const f = fixture();
  const result = f.run(["issue", "--domain", "kairosq.cn", "--domain", "www.kairosq.cn", "--domain", "kairosq.cn", "--accept-subscriber-agreement", terms]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(f.log(), /--domain www\.kairosq\.cn/);
  assert.equal((f.log().match(/--domain kairosq\.cn/g) || []).length, 1);
  assert.match(f.log(), /-checkhost kairosq\.cn/);
  assert.match(f.log(), /-checkhost www\.kairosq\.cn/);
});

test("a certificate missing a requested alias never replaces the current pair", () => {
  const f = fixture({ TEST_BAD_ALIAS: "1" });
  const result = f.run([...issueArgs, "--domain", "www.kairosq.cn"]);
  assert.notEqual(result.status, 0);
  assert.equal(f.cert(), "OLD CERT\n");
  assert.equal(f.key(), "OLD KEY\n");
});

test("renewal keeps the primary lineage and still validates every requested alias", () => {
  const f = fixture({ TEST_BAD_ALIAS: "1" });
  mkdirSync(path.join(f.root, "runtime/acme/config/renewal"), { recursive: true });
  writeFileSync(path.join(f.root, "runtime/acme/config/renewal/kairosq.cn.conf"), "fixture");
  assert.notEqual(f.run(["renew", ...issueArgs.slice(1), "--domain", "www.kairosq.cn"]).status, 0);
  assert.match(f.log(), /renew .*--cert-name kairosq\.cn/);
  assert.match(f.log(), /-checkhost www\.kairosq\.cn/);
  assert.equal(f.cert(), "OLD CERT\n");
});

test("unchanged valid certificates do not migrate or reload existing files", () => {
  const f = fixture({ TEST_UNCHANGED: "1" });
  const result = f.run(issueArgs);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /unchanged/i);
  assert.equal(existsSync(path.join(f.root, "runtime/certs/.acme-current")), false);
  assert.doesNotMatch(f.log(), /nginx -s reload/);
});

test("renewal requires an existing lineage and explicit agreement", () => {
  const f = fixture();
  assert.notEqual(f.run(["renew", ...issueArgs.slice(1)]).status, 0);
  assert.equal(f.log(), "");
  assert.equal(f.run(["renew", "--domain", "kairosq.cn"]).status, 64);
});
