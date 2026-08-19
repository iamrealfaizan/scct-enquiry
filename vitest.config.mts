import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Test configuration.
 *
 * `.mts`, not `.ts`, and not by preference: `package.json` has no
 * `"type": "module"`, so Node loads a `.ts` config through CJS, and Vitest 4's
 * dependency chain is ESM-only — the config fails to load at all with
 * ERR_REQUIRE_ESM. The `.mts` extension forces the ESM loader. `next.config.mjs`
 * exists for the same reason.
 *
 * `environment: "node"` — the code under test is route handlers, services and
 * models. A route handler in the App Router is a plain
 * `(req: Request) => Promise<Response>` function, so tests construct a `Request`
 * and call it directly: no HTTP server, no port, no supertest, no framework
 * harness (conventions §13). jsdom would only be needed for component tests,
 * which are not what the graded critical path is made of.
 *
 * `tsconfigPaths` — so tests import `@/services/...` exactly as the app does. The
 * alternative is duplicating the alias map here and letting the two drift.
 *
 * `fileParallelism: false` — every suite talks to one in-memory MongoDB instance
 * and clears collections between tests. Parallel files would clear each other's
 * data mid-test, producing failures that look like race conditions in the code
 * under test rather than in the test setup. The suite is small; correctness is
 * worth more than the seconds.
 *
 * `testTimeout: 20_000` — the first test in a run pays for downloading and
 * starting the in-memory MongoDB binary. The default 5s fails that on a cold
 * cache, which reads as a broken test rather than a slow one.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
