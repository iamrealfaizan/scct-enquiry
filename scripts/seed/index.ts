import "../load-env";

import mongoose from "mongoose";

import { db, disconnectDb } from "@/lib/db";

import { seedEnquiries } from "./enquiries";
import { seedPermissions } from "./permissions";
import { seedProgrammes } from "./programmes";
import { seedRoles } from "./roles";
import { seedSources } from "./sources";
import { seedStaff } from "./staff";
import { seedStatuses } from "./statuses";

/**
 * Seed the system's configuration and its synthetic staff accounts.
 *
 *     npm run seed
 *
 * IDEMPOTENT AND NON-DESTRUCTIVE. Every write is an upsert matched on `code`.
 * Running this twice leaves a working system exactly as it found it, which is the
 * property that makes it safe to point at the deployed database. Nothing here
 * deletes or drops anything — that is `npm run db:reset`, which is a separate,
 * guarded, explicitly destructive script.
 *
 * ORDER IS A DEPENDENCY CHAIN, not a preference:
 *   permissions → roles (reference permission ids) → staff (reference role ids)
 * The three lookup tables have no dependencies and could run in parallel; they
 * run in sequence anyway, because an M0 cluster gains nothing from five
 * concurrent writes and sequential output is readable when something fails.
 *
 * DEMO ENQUIRIES ARE OPT-IN:
 *
 *     npm run seed                    configuration and staff only
 *     npm run seed -- --enquiries=40  and 40 synthetic enquiries
 *
 * Opt-in rather than automatic because this script is pointed at the DEPLOYED
 * database, where creating forty records nobody asked for is a surprise at best.
 * Every one of them goes through `createEnquiry()` — the single enquiry write path
 * (conventions §15) — never a direct insert; see `enquiries.ts` for why that
 * matters more than it looks.
 */

/**
 * `--enquiries=<n>`, or `--enquiries` for the default 40.
 *
 * Parsed strictly: a malformed value stops the run rather than being coerced to
 * something plausible. `--enquiries=abc` silently becoming 0 would report success
 * while doing nothing, and `--enquiries=100000` against an M0 cluster is not a
 * request anyone makes on purpose.
 */
function parseEnquiryCount(argv: string[]): number | null {
  const arg = argv.find((value) => value === "--enquiries" || value.startsWith("--enquiries="));

  if (!arg) return null;
  if (arg === "--enquiries") return 40;

  const raw = arg.slice("--enquiries=".length);
  const count = Number(raw);

  if (!Number.isInteger(count) || count < 1 || count > 2_000) {
    throw new Error(
      `--enquiries expects a whole number between 1 and 2000, received "${raw}".`,
    );
  }

  return count;
}

async function main() {
  const enquiryCount = parseEnquiryCount(process.argv.slice(2));

  await db();

  console.log(`\n  Seeding "${mongoose.connection.name}"\n`);

  const permissions = await seedPermissions();
  const roles = await seedRoles(permissions.ids);
  const staff = await seedStaff(roles.ids);
  const programmes = await seedProgrammes();
  const sources = await seedSources();
  const statuses = await seedStatuses();

  const steps = [permissions, roles, staff, programmes, sources, statuses];

  for (const step of steps) {
    const unchanged = step.total - step.created;
    console.log(
      `  ${step.label.padEnd(14)} ${String(step.total).padStart(3)} total` +
        `   ${step.created} created` +
        `   ${unchanged} already present`,
    );
  }

  console.log("\n  Demo logins — SYNTHETIC ACCOUNTS, password from DEMO_PASSWORD:\n");
  for (const account of staff.accounts) {
    console.log(
      `    ${account.email.padEnd(40)} ${account.role.padEnd(11)}` +
        `${account.eligible ? "eligible for assignment" : "not in assignment rota"}`,
    );
  }

  // Enquiries last: they depend on programmes, sources, the default status AND the
  // staff rota, because createEnquiry() resolves all four.
  if (enquiryCount !== null) {
    console.log(`\n  Generating ${enquiryCount} synthetic enquiries via createEnquiry()\n`);

    // `shape` on: stage and follow-up variety, applied through changeStatus() and
    // scheduleFollowUp() rather than by writing the fields. Without it every record
    // sits in the default stage with no follow-up, and the queue's stage filter,
    // urgency sort and overdue badge have nothing to return — a filter nobody has
    // seen work is a filter nobody knows is broken.
    const enquiries = await seedEnquiries({
      count: enquiryCount,
      verbose: true,
      shape: true,
    });

    console.log(
      `\n  enquiries      ${String(enquiries.total).padStart(3)} requested` +
        `   ${enquiries.created} created` +
        `   ${enquiries.replayed} already present (idempotency key)` +
        `\n                     ${enquiries.duplicatesFlagged} flagged as possible duplicates` +
        `   ${enquiries.unassigned} unassigned` +
        `\n                     ${enquiries.stagesMoved} stages moved` +
        `   ${enquiries.followUpsScheduled} follow-ups scheduled` +
        `   ${enquiries.backdated} backdated`,
    );

    if (enquiries.failures.length > 0) {
      // Reported and non-zero exit. A seed that half-completed and claimed success
      // is the failure mode this project is graded against.
      console.error(`\n  ${enquiries.failures.length} enquiries failed:`);
      for (const failure of enquiries.failures) console.error(`    ${failure}`);
      process.exitCode = 1;
    }
  }

  console.log(
    "\n  Statuses and the source taxonomy are UNCONFIRMED PLACEHOLDERS.\n" +
      "  Indexes are NOT created by this script — run `npm run db:indexes`.\n" +
      (enquiryCount === null
        ? "  No demo enquiries created. Add `-- --enquiries=40` for a populated queue.\n"
        : "  Stages and follow-ups were set by calling the workflow services, so every\n" +
          "  entry in each enquiry's history genuinely happened.\n"),
  );
}

main()
  .catch((err) => {
    // Explicit failure, non-zero exit. A seed that half-completed and reported
    // success is worse than one that stops: the next thing to run would be the
    // app, against configuration that is missing a row nothing warned about.
    console.error("\n  Seed failed:", err instanceof Error ? err.message : err, "\n");
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDb();
  });
