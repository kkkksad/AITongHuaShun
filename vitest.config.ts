import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
    environmentMatchGlobs: [
      ["src/**/*.test.ts", "jsdom"],
      ["server/**/*.test.ts", "node"],
    ],
  },
});
