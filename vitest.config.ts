import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["server/**/*.test.ts", "tests/qa/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
    fileParallelism: false,
  },
})
