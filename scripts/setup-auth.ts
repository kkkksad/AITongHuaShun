import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "../server/auth";

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%+-_";

function readArgument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function generatePassword(length = 24): string {
  return Array.from(
    { length },
    () => PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)],
  ).join("");
}

function updateEnvironment(
  source: string,
  values: Record<string, string>,
  defaults: Record<string, string>,
): string {
  const updates = new Map(Object.entries(values));
  const existingKeys = new Set<string>();
  const lines = source ? source.replace(/\r\n/g, "\n").split("\n") : [];
  const updated = lines.map((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (!match) return line;
    const key = match[1];
    existingKeys.add(key);
    const value = updates.get(key);
    if (value === undefined) return line;
    updates.delete(key);
    return `${key}=${value}`;
  });

  const additions = [
    ...updates.entries(),
    ...Object.entries(defaults).filter(([key]) => !existingKeys.has(key)),
  ];
  while (updated.length > 0 && updated.at(-1) === "") updated.pop();
  if (additions.length > 0) {
    updated.push("", "# Required KAIROS server session authentication.");
    for (const [key, value] of additions) updated.push(`${key}=${value}`);
  }
  return `${updated.join("\n")}\n`;
}

async function main() {
  const username = readArgument("--username");
  if (!username || !/^[A-Za-z0-9_.-]{3,64}$/.test(username)) {
    throw new Error(
      "Usage: npm run auth:setup -- --username <3-64 letters, numbers, dot, underscore or hyphen>",
    );
  }
  const environmentFile = readArgument("--env-file") ?? ".env.local";
  if (![".env", ".env.local", ".env.production"].includes(environmentFile)) {
    throw new Error("--env-file must be .env, .env.local, or .env.production");
  }
  const environmentPath = path.resolve(process.cwd(), environmentFile);
  const production = process.argv.includes("--production");

  const password = generatePassword();
  const passwordHash = await hashPassword(password);
  const storedPasswordHash = production ? `'${passwordHash}'` : passwordHash;
  const current = await fs.readFile(environmentPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const next = updateEnvironment(
    current,
    {
      AUTH_ENABLED: "true",
      AUTH_USERNAME: username,
      AUTH_PASSWORD_HASH: storedPasswordHash,
      ...(production ? { AUTH_COOKIE_SECURE: "true" } : {}),
    },
    {
      AUTH_SESSION_TTL_SECONDS: "28800",
      AUTH_COOKIE_SECURE: "false",
      AUTH_MAX_SESSIONS: "3",
      AUTH_LOGIN_RATE_LIMIT_MAX: "5",
      TRUST_PROXY: "false",
    },
  );
  const temporaryPath = `${environmentPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, next, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporaryPath, environmentPath);

  console.log(`KAIROS authentication configured for ${username}.`);
  console.log(`Initial password (shown once): ${password}`);
  console.log(`Only the scrypt password hash was written to ${environmentFile}.`);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
