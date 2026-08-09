import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production web image permissions", () => {
  it("makes copied Vite assets readable by the unprivileged Nginx worker", () => {
    const dockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");

    expect(dockerfile).toContain("find /usr/share/nginx/html -type d -exec chmod 0755");
    expect(dockerfile).toContain("find /usr/share/nginx/html -type f -exec chmod 0644");
  });
});
