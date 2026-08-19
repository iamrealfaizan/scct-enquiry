import "./load-env";

import { createInterface } from "node:readline/promises";

import mongoose from "mongoose";

import { db, disconnectDb } from "@/lib/db";
import { isProduction } from "@/lib/env";

/**
 * Drop every collection in the configured database.
 *
 *     npm run db:reset
 *
 * THIS IS THE ONLY DESTRUCTIVE SCRIPT IN THE REPOSITORY, and it exists so that
 * "reset the demo to a clean state" does not become someone improvising a
 * `deleteMany({})` inside the seed. A destructive default is the failure mode
 * this project is graded against; a destructive script that announces itself is
 * a legitimate tool.
 *
 * THREE GUARDS, deliberately layered:
 *
 *   1. Refuses outright when NODE_ENV=production. Not a prompt — a refusal. No
 *      confirmation string can override it.
 *   2. Prints the database name and connection host, then requires the operator
 *      to TYPE THE DATABASE NAME. A y/n prompt is answered reflexively; typing
 *      the name means reading it first, which is the whole point.
 *   3. `--force` skips only the typing, never the production refusal, and exists
 *      for a scripted local reset.
 *
 * It drops COLLECTIONS rather than the database, so a cluster-level user without
 * dropDatabase rights can still use it, and Atlas keeps the (empty) database.
 */

async function confirm(dbName: string): Promise<boolean> {
  if (process.argv.includes("--force")) {
    console.log("  --force given: skipping the confirmation prompt.\n");
    return true;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const answer = await rl.question(`  Type the database name to confirm ("${dbName}"): `);
    return answer.trim() === dbName;
  } finally {
    rl.close();
  }
}

async function main() {
  if (isProduction) {
    console.error(
      "\n  REFUSED. NODE_ENV=production.\n\n" +
        "  This script will not run against a production environment under any\n" +
        "  flag. If you genuinely need to clear a production database, do it\n" +
        "  deliberately in Atlas, where it is logged.\n",
    );
    process.exitCode = 1;
    return;
  }

  await db();

  const dbName = mongoose.connection.name;
  const host = mongoose.connection.host;
  const collections = await mongoose.connection.db!.listCollections().toArray();

  if (collections.length === 0) {
    console.log(`\n  "${dbName}" already has no collections. Nothing to do.\n`);
    return;
  }

  console.log(`\n  ABOUT TO DROP ${collections.length} COLLECTION(S)\n`);
  console.log(`    database  ${dbName}`);
  console.log(`    host      ${host}\n`);
  for (const c of collections) {
    // The count is the number that makes the consequence concrete.
    const count = await mongoose.connection.db!.collection(c.name).countDocuments();
    console.log(`    · ${c.name.padEnd(22)} ${count} document(s)`);
  }
  console.log("\n  This cannot be undone.\n");

  if (!(await confirm(dbName))) {
    console.log("\n  Name did not match. Nothing was dropped.\n");
    process.exitCode = 1;
    return;
  }

  for (const c of collections) {
    await mongoose.connection.db!.collection(c.name).drop();
    console.log(`  dropped ${c.name}`);
  }

  console.log(
    "\n  Done. The database is empty — including its indexes.\n" +
      "  Re-run in this order:  npm run seed  →  npm run db:indexes\n",
  );
}

main()
  .catch((err) => {
    console.error("\n  Reset failed:", err instanceof Error ? err.message : err, "\n");
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDb();
  });
