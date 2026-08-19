import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, afterEach } from "vitest";

/**
 * Test database — an in-memory MongoDB, started once per test process.
 *
 * WHY IN-MEMORY AND NOT ATLAS. Tests that need a cloud cluster and a secret are
 * tests that do not run: not in CI, not on a reviewer's machine, and not on a
 * plane. `mongodb-memory-server` runs a real mongod binary, so it is not a mock —
 * unique indexes, partial indexes, `$inc` atomicity and write errors all behave
 * exactly as they will in Atlas. Those are precisely the behaviours the critical
 * path depends on, so mocking the database would test nothing worth testing.
 *
 * WHY THIS IS ALL AT MODULE TOP LEVEL, NOT IN `beforeAll`. `lib/env.ts` validates
 * the environment at IMPORT time, and a test importing a route handler pulls in
 * `lib/db.ts` → `lib/env.ts` while the test file is being collected — which happens
 * before any `beforeAll` callback runs. Setting MONGODB_URI in a hook is therefore
 * too late, and the failure looks like a missing .env.local rather than an ordering
 * problem. Setup files are imported before test files, so top-level await here runs
 * first.
 *
 * The values below are obvious throwaways. A test secret that looked like a real
 * one would be a genuine hazard sitting in the repository.
 *
 * NODE_ENV is set to "test" by Vitest itself, and is typed read-only.
 */

process.env.MONGODB_DB = "scct_enquiry_test";
process.env.SESSION_SECRET = "test-only-session-secret-not-a-real-key-0123456789";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.DEMO_PASSWORD = "test-only-demo-password";

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri();

await mongoose.connect(process.env.MONGODB_URI, {
  dbName: process.env.MONGODB_DB,
  // ON here, unlike the app (lib/db.ts explains why it is off there). Tests must
  // exercise real index behaviour — a uniqueness or idempotency test against an
  // unindexed collection passes for the wrong reason and would hide exactly the
  // bug it exists to catch.
  autoIndex: true,
});

afterEach(async () => {
  // Clear rather than drop: dropping a collection also drops its indexes, and the
  // next test would then run unindexed. deleteMany keeps the indexes in place.
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
