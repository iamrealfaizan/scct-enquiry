import type { Model, Types } from "mongoose";

/**
 * The one upsert used by every lookup-table seeder.
 *
 * THE RULE THIS ENFORCES: seeding is idempotent and never destructive. Running
 * `npm run seed` a second time must leave a working system exactly as it found
 * it, because it will be run against the deployed database.
 *
 * THE IMPORTANT DISTINCTION, and the reason this is a shared helper rather than
 * an inline `findOneAndUpdate` in six files:
 *
 *   `$set`         — definitional fields the seed OWNS. A label typo fixed in the
 *                    seed should propagate on the next run.
 *   `$setOnInsert` — fields the seed only proposes an INITIAL value for. Lifecycle
 *                    flags live here, so a row an admin deliberately archived is
 *                    not silently resurrected by the next seed run. That is a
 *                    destructive change disguised as a create.
 *
 * Matching is by `code`, never by `_id` or by label: codes are the stable
 * identifier business logic reads (conventions §9), and a label may legitimately
 * change once SCCT confirms its terminology.
 */

export type SeedOutcome = "created" | "updated";

export type UpsertResult<T> = {
  doc: T;
  outcome: SeedOutcome;
};

export async function upsertByCode<T extends { _id: Types.ObjectId }>(
  model: Model<T>,
  code: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fields: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onInsertOnly: Record<string, any> = {},
): Promise<UpsertResult<T>> {
  // Establishes whether this run creates or updates, which is what the seed
  // reports. `upsertedCount` alone would not tell us, because we need the
  // document back anyway.
  const existing = await model.exists({ code } as never);

  const doc = await model.findOneAndUpdate(
    { code } as never,
    {
      $set: fields,
      $setOnInsert: {
        code,
        // Everything the seed writes is a system row: seeded, not user-created.
        // `isSystem` guards it from deletion through a future config screen.
        isSystem: true,
        isActive: true,
        isArchived: false,
        ...onInsertOnly,
      },
    },
    {
      upsert: true,
      new: true,
      // Applies schema defaults on insert. Without it an upsert writes only the
      // fields named above, and a field with a schema default but no explicit
      // value here would be absent rather than defaulted.
      setDefaultsOnInsert: true,
      runValidators: true,
    },
  );

  if (!doc) {
    // Should be unreachable with `upsert: true, new: true` — but an unexplained
    // null here would surface later as a confusing ref to nothing.
    throw new Error(`upsertByCode(${model.modelName}, "${code}") returned no document`);
  }

  return { doc, outcome: existing ? "updated" : "created" };
}
