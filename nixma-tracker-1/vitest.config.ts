import { defineConfig } from "vitest/config";

// First-pass test setup: covers the pure calculation functions in lib/
// (schedule status/progress math, module readiness, the progress-tree
// rollup) -- deliberately not testing React components or API routes yet,
// since those need real mocking infrastructure (Supabase client, fetch)
// this pass doesn't set up. Node environment is enough for pure TS logic
// with no DOM dependency.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
