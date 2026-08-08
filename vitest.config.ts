import { configDefaults } from "vitest/config";

export default {
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  test: {
    exclude: [...configDefaults.exclude, "**/.pytest_cache/**"],
  },
};
