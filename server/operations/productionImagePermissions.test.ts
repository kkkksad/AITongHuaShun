import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production web image permissions", () => {
  it("excludes production environment credentials from the Docker build context", () => {
    const patterns = readFileSync(resolve(process.cwd(), ".dockerignore"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim());
    expect(patterns).toContain(".env");
    expect(patterns).toContain(".env.*");
    expect(patterns).not.toContain("!.env.production");
  });

  it("makes copied Vite assets readable by the unprivileged Nginx worker", () => {
    const dockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");

    expect(dockerfile).toContain("find /usr/share/nginx/html -type d -exec chmod 0755");
    expect(dockerfile).toContain("find /usr/share/nginx/html -type f -exec chmod 0644");
  });

  it("keeps frontend assets out of the API runtime image", () => {
    const dockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");
    const production = dockerfile.slice(dockerfile.indexOf("FROM node:20-alpine AS production"));
    expect(production).not.toContain("COPY --from=builder /app/dist ./dist");
    expect(production).toContain("COPY --from=builder /app/server ./server");
    expect(production).toContain("COPY --from=builder /app/shared ./shared");
    expect(production).not.toContain("EXPOSE 3001 4173");
    expect(production).toContain("EXPOSE 3001");
  });
});
