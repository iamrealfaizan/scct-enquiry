import "./load-env";

import mongoose from "mongoose";

import { db, disconnectDb } from "@/lib/db";
import * as models from "@/models";

/**
 * Create every index declared in the model files. Run with:
 *
 *     npm run db:indexes
 *
 * WHY THIS IS A SCRIPT AND NOT `autoIndex: true`. Mongoose can build indexes on
 * connect, but that makes index creation an invisible side effect of whichever
 * request happens to be first, on whichever instance happens to be cold. Three
 * consequences we do not want: the first user pays for the build, development
 * and production can silently disagree about which indexes exist, and nobody can
 * answer "are the indexes there?" without inspecting the cluster.
 *
 * As a script it is a deliberate, observable step with printed output — which is
 * also the answer to "how do you know your queries are indexed?".
 *
 * WHY `syncIndexes` AND NOT `createIndexes`. `syncIndexes` also DROPS indexes
 * that exist on the collection but are no longer declared in the model. That
 * matters here because every index is explicitly named (conventions §5.9), so a
 * renamed index would otherwise leave its predecessor behind forever, costing
 * write throughput for an index nothing queries.
 *
 * It only ever drops INDEXES. It never touches a document. The one thing it can
 * legitimately fail on is an existing index whose definition changed — reported
 * below rather than swallowed.
 */

async function main() {
  await db();

  // Distinguish the models from the interface re-exports in `@/models`: the index
  // re-exports both, and only a compiled model has `.syncIndexes`. Typed loosely
  // on purpose — this walks twelve models with twelve different document types,
  // and the only capability it needs is the one checked for right here.
  type IndexableModel = Pick<
    mongoose.Model<never>,
    "modelName" | "syncIndexes" | "listIndexes"
  >;

  const entries = Object.entries(models as Record<string, unknown>)
    .filter(([, value]) => typeof (value as IndexableModel)?.syncIndexes === "function")
    .map(([name, value]) => [name, value as IndexableModel] as const);

  console.log(
    `\n  Syncing indexes for ${entries.length} models on "${mongoose.connection.name}"\n`,
  );

  let created = 0;
  let dropped = 0;
  const failures: Array<{ model: string; message: string }> = [];

  for (const [name, model] of entries) {
    try {
      // Returns the names of the indexes it dropped, if any.
      const droppedNames = await model.syncIndexes();
      const indexes = await model.listIndexes();

      // Every index we declare is named; the implicit `_id_` index is not ours.
      const ours = indexes.filter((i) => i.name && i.name !== "_id_");

      created += ours.length;
      dropped += droppedNames.length;

      console.log(`  ${name.padEnd(18)} ${ours.length} index(es)`);
      for (const index of ours) {
        const flags = [index.unique && "unique", index.sparse && "sparse"]
          .filter(Boolean)
          .join(", ");
        console.log(`    · ${index.name}${flags ? `  [${flags}]` : ""}`);
      }
      for (const droppedName of droppedNames) {
        console.log(`    · dropped: ${droppedName} (no longer declared)`);
      }
    } catch (err) {
      // Collected, not thrown: one model with a conflicting index definition
      // must not stop the other eleven from being indexed correctly.
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ model: name, message });
      console.error(`  ${name.padEnd(18)} FAILED — ${message}`);
    }
  }

  console.log(
    `\n  ${created} index(es) present, ${dropped} dropped, ${failures.length} model(s) failed.\n`,
  );

  if (failures.length > 0) {
    console.error(
      "  An index definition conflicts with one already on the collection.\n" +
        "  Mongo will not silently redefine an index. Drop the named index in\n" +
        "  Atlas and re-run, or run `npm run db:reset` if the data is disposable.\n",
    );
    // Non-zero exit so this fails a deployment step rather than appearing to pass.
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("\n  Index sync failed:", err instanceof Error ? err.message : err, "\n");
    process.exitCode = 1;
  })
  .finally(async () => {
    // A script is a process that must exit. An open pool would hang it.
    await disconnectDb();
  });
