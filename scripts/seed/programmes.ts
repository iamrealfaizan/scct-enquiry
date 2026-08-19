import type { Types } from "mongoose";

import { Programme } from "@/models";

import { upsertByCode } from "./upsert";

/**
 * The seven Degree College programmes.
 *
 * THESE ARE CONFIRMED SCCT FACTS — the only part of the seeded configuration
 * that is. Everything else the seed writes (statuses, the source taxonomy) is a
 * labelled synthetic placeholder.
 *
 * `stream` IS DELIBERATELY UNSET. The model supports NEP / NON_NEP, but which
 * programme sits in which stream has not been confirmed. Guessing it would put
 * an invented client fact into the database and then into reporting, which is a
 * listed critical failure. The field stays empty until SCCT answers; the schema
 * is ready for the answer.
 *
 * `displayOrder` follows the ordering used in the brief, so the form's dropdown
 * reads in an order staff will recognise rather than alphabetically.
 */

export const PROGRAMME_CODES = {
  BCOM: "BCOM",
  BCOM_MS: "BCOM_MS",
  BAF: "BAF",
  BBI: "BBI",
  BAMMC: "BAMMC",
  BSC_IT: "BSC_IT",
  BSC_CS: "BSC_CS",
} as const;

export type ProgrammeCode = (typeof PROGRAMME_CODES)[keyof typeof PROGRAMME_CODES];

const PROGRAMMES: Array<{
  code: ProgrammeCode;
  name: string;
  shortName: string;
  displayOrder: number;
}> = [
  { code: PROGRAMME_CODES.BCOM, name: "Bachelor of Commerce", shortName: "B.Com", displayOrder: 10 },
  {
    code: PROGRAMME_CODES.BCOM_MS,
    name: "Bachelor of Commerce (Management Studies)",
    shortName: "B.Com (MS)",
    displayOrder: 20,
  },
  {
    code: PROGRAMME_CODES.BAF,
    name: "Bachelor of Accounting and Finance",
    shortName: "BAF",
    displayOrder: 30,
  },
  {
    code: PROGRAMME_CODES.BBI,
    name: "Bachelor of Banking and Insurance",
    shortName: "BBI",
    displayOrder: 40,
  },
  {
    code: PROGRAMME_CODES.BAMMC,
    name: "Bachelor of Arts in Multimedia and Mass Communication",
    shortName: "BAMMC",
    displayOrder: 50,
  },
  {
    code: PROGRAMME_CODES.BSC_IT,
    name: "Bachelor of Science in Information Technology",
    shortName: "B.Sc IT",
    displayOrder: 60,
  },
  {
    code: PROGRAMME_CODES.BSC_CS,
    name: "Bachelor of Science in Computer Science",
    shortName: "B.Sc CS",
    displayOrder: 70,
  },
];

export type ProgrammeIds = Map<ProgrammeCode, Types.ObjectId>;

export async function seedProgrammes() {
  const ids: ProgrammeIds = new Map();
  let created = 0;

  for (const programme of PROGRAMMES) {
    const { doc, outcome } = await upsertByCode(Programme, programme.code, {
      name: programme.name,
      shortName: programme.shortName,
      displayOrder: programme.displayOrder,
    });

    if (outcome === "created") created += 1;
    ids.set(programme.code, doc._id);
  }

  return { label: "programmes", total: PROGRAMMES.length, created, ids };
}
