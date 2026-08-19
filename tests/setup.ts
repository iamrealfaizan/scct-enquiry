import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll } from "vitest";

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
 * ENVIRONMENT IS SET BEFORE ANY IMPORT THAT READS IT. `lib/env.ts` validates at
 * import time and throws on a missing secret, and `lib/db.ts` imports it. Setting
 * these here — in a setup file, which Vitest runs before the test modules — is
 * what keeps every test file free of environment boilerplate.
 *
 * The values are obvious throwaways. A test secret that looked like a real one
 * would be a genuine hazard sitting in the repository.
 */

// NODE_ENV is set to "test" by Vitest itself, and is typed read-only — assigning
// it here would be both redundant and a type error.
process.env.MONGODB_DB = "scct_enquiry_test";
process.env.SESSION_SECRET =
  "test-only-session-secret-not-a-real-key-0123456789";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.DEMO_PASSWORD = "test-only-demo-password";

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();

  // Set before connecting, because lib/db.ts reads the URI through lib/env.ts,
  // which parsed it at import time — so tests connect through mongoose directly
  // rather than through db(). Handlers under test still call db(); it finds this
  // connection already established on the shared mongoose instance and returns it.
  process.env.MONGODB_URI = mongo.getUri();

  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.MONGODB_DB,
    // ON here, unlike the app (lib/db.ts explains why it is off there). Tests
    // must exercise real index behaviour — a uniqueness or idempotency test
    // against an unindexed collection passes for the wrong reason and would hide
    // exactly the bug it exists to catch.
    autoIndex: true,
  });
});

afterEach(async () => {
  // Clear rather than drop: dropping a collection also drops its indexes, and the
  // next test would then run unindexed. deleteMany keeps the indexes in place.
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
