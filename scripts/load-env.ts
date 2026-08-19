import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config } from "dotenv";

/**
 * Load environment variables for scripts.
 *
 * WHY THIS IS NEEDED. Next.js loads `.env.local` itself, so the app never has to
 * think about it. Scripts run under `tsx` — a plain Node process with no Next
 * involved — so nothing has populated `process.env` yet. Without this, the first
 * thing a script hits is `lib/env.ts` failing on a missing MONGODB_URI, which
 * looks like a configuration bug rather than a loading order problem.
 *
 * PRECEDENCE, highest first — matching Next's own order so a script and the app
 * always read the same values:
 *
 *   1. variables already in the real environment (CI, Vercel, an inline prefix)
 *   2. .env.local   — the developer's real, gitignored values
 *   3. .env         — committed defaults, if one ever exists (today it does not)
 *
 * dotenv does not overwrite an existing key, so loading in this order gives that
 * precedence for free.
 *
 * MUST BE IMPORTED FIRST, before anything that reads `process.env` at import
 * time — which `lib/env.ts` deliberately does. Every script therefore starts
 * with a bare `import "./load-env";` on its own line above the other imports.
 */

const root = process.cwd();

for (const file of [".env.local", ".env"]) {
  const path = resolve(root, file);
  if (existsSync(path)) config({ path });
}

// A script that cannot reach a database should say so in one line, before
// lib/env.ts produces its (correct, but longer) validation error.
if (!process.env.MONGODB_URI) {
  console.error(
    "\n  No MONGODB_URI found.\n\n" +
      "  Scripts read `.env.local`, which is gitignored and not created for you:\n\n" +
      "      cp .env.example .env.local\n\n" +
      "  then fill in your Atlas connection string.\n",
  );
  process.exit(1);
}
