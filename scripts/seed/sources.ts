import type { Types } from "mongoose";

import { SOURCE_CODES, type SourceCode } from "@/config/codes";
import { EnquirySource } from "@/models";

import { upsertByCode } from "./upsert";

/**
 * The enquiry source taxonomy — and the real finding it encodes.
 *
 * THE FINDING. The pre-discovery material contains TWO source lists that do not
 * reconcile:
 *
 *   route analysis   walk-ins · social media · in-house students · teacher calling
 *                    through purchased data · website · references · University tag lists
 *   source analysis  Google Search · friends/family · school/teacher ·
 *                    train advertisements · other · blank/unattributed
 *
 * They overlap ("website" vs "Google Search"), sit at different levels ("social
 * media" is a channel, "friends/family" is a relationship), and one has an
 * explicit unattributed bucket while the other does not. The source taxonomy is
 * NOT normalised. That is a genuine finding about SCCT's current data, not a gap
 * in this build.
 *
 * HOW IT IS HANDLED. Both lists are seeded AS REPORTED, each tagged with the
 * `taxonomyGroup` it came from, and every row has `canonicalSource: null`.
 *
 * NO CANONICAL ROWS ARE SEEDED, deliberately. Inventing a canonical taxonomy and
 * mapping these thirteen rows into it would mean inventing a client fact and then
 * reporting on it as though SCCT had confirmed it — a listed critical failure.
 * The self-ref column exists and is ready; the day SCCT confirms the mapping it
 * is a data change, and every historical enquiry keeps the raw source it actually
 * arrived with (`Enquiry.rawSourceValue`) so the mapping stays auditable and
 * reversible.
 *
 * So the finding lives in the data as a reviewable structure, rather than as a
 * paragraph in the README that nobody can act on.
 */



const SOURCES: Array<{
  code: SourceCode;
  label: string;
  taxonomyGroup: "route_analysis" | "source_analysis";
  displayOrder: number;
}> = [
  // Route analysis — how the enquiry reached SCCT operationally.
  { code: SOURCE_CODES.WALK_IN, label: "Walk-in", taxonomyGroup: "route_analysis", displayOrder: 10 },
  {
    code: SOURCE_CODES.SOCIAL_MEDIA,
    label: "Social media",
    taxonomyGroup: "route_analysis",
    displayOrder: 20,
  },
  {
    code: SOURCE_CODES.IN_HOUSE_STUDENT,
    label: "In-house student",
    taxonomyGroup: "route_analysis",
    displayOrder: 30,
  },
  {
    code: SOURCE_CODES.TEACHER_CALLING_PURCHASED_DATA,
    label: "Teacher calling (purchased data)",
    taxonomyGroup: "route_analysis",
    displayOrder: 40,
  },
  { code: SOURCE_CODES.WEBSITE, label: "Website", taxonomyGroup: "route_analysis", displayOrder: 50 },
  {
    code: SOURCE_CODES.REFERENCE,
    label: "Reference",
    taxonomyGroup: "route_analysis",
    displayOrder: 60,
  },
  {
    code: SOURCE_CODES.UNIVERSITY_TAG_LIST,
    label: "University tag list",
    taxonomyGroup: "route_analysis",
    displayOrder: 70,
  },

  // Source analysis — how the prospective student says they heard of SCCT.
  {
    code: SOURCE_CODES.GOOGLE_SEARCH,
    label: "Google Search",
    taxonomyGroup: "source_analysis",
    displayOrder: 110,
  },
  {
    code: SOURCE_CODES.FRIENDS_FAMILY,
    label: "Friends / family",
    taxonomyGroup: "source_analysis",
    displayOrder: 120,
  },
  {
    code: SOURCE_CODES.SCHOOL_TEACHER,
    label: "School / teacher",
    taxonomyGroup: "source_analysis",
    displayOrder: 130,
  },
  {
    code: SOURCE_CODES.TRAIN_ADVERTISEMENT,
    label: "Train advertisement",
    taxonomyGroup: "source_analysis",
    displayOrder: 140,
  },
  { code: SOURCE_CODES.OTHER, label: "Other", taxonomyGroup: "source_analysis", displayOrder: 150 },
  {
    // The "blank" category from the source analysis. Named rather than left as an
    // absent value: an enquiry whose origin is unknown is a fact worth recording,
    // and a nullable source would make every report quietly incomplete.
    code: SOURCE_CODES.UNATTRIBUTED,
    label: "Unattributed",
    taxonomyGroup: "source_analysis",
    displayOrder: 160,
  },
];

export type SourceIds = Map<SourceCode, Types.ObjectId>;

export async function seedSources() {
  const ids: SourceIds = new Map();
  let created = 0;

  for (const source of SOURCES) {
    const { doc, outcome } = await upsertByCode(
      EnquirySource,
      source.code,
      {
        label: source.label,
        taxonomyGroup: source.taxonomyGroup,
        displayOrder: source.displayOrder,
      },
      {
        // INSERT ONLY. If SCCT later confirms the mapping and someone points
        // these rows at canonical parents, re-running the seed must not wipe
        // that work — which `$set: { canonicalSource: null }` would do on every
        // run.
        canonicalSource: null,
      },
    );

    if (outcome === "created") created += 1;
    ids.set(source.code, doc._id);
  }

  return { label: "sources", total: SOURCES.length, created, ids };
}
