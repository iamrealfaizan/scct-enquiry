import { jsonFail, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { ERROR_CODES } from "@/lib/result";
import { EnquirySource, EnquiryStatus, Programme } from "@/models";

/**
 * GET /api/config — the values every dropdown in the system needs.
 *
 * Read-only, unauthenticated, and it holds nothing sensitive: programme names, the
 * source list and the enquiry stages. The public form needs programmes before a
 * session exists, so gating this would mean a second, near-identical endpoint.
 *
 * WHY THE FORM DOES NOT HARDCODE THESE. Programmes, sources and statuses are
 * lookup tables precisely because SCCT will change them. A hardcoded dropdown
 * would make "add a programme" a deployment, and would let the form and the
 * database disagree about what is valid — which shows up as a submission that
 * passes client validation and then fails on the server.
 *
 * `isPlaceholder` IS PASSED THROUGH. The UI needs it to label unconfirmed stages
 * honestly, and it must come from the data rather than a hardcoded list in the
 * component — otherwise the labelling drifts the moment SCCT confirms a stage.
 */
export async function GET() {
  try {
    await db();
  } catch {
    return jsonFail(
      ERROR_CODES.DB_UNAVAILABLE,
      "Configuration is unavailable right now. Please try again.",
    );
  }

  try {
    // `lean()` — these are read-only projections handed straight to a client. A
    // hydrated Mongoose document would carry machinery the response never uses.
    const [programmes, sources, statuses] = await Promise.all([
      Programme.find({ isActive: true, isArchived: false })
        .select("code name shortName displayOrder")
        .sort({ displayOrder: 1 })
        .lean(),

      EnquirySource.find({ isActive: true, isArchived: false })
        .select("code label taxonomyGroup displayOrder")
        .sort({ displayOrder: 1 })
        .lean(),

      EnquiryStatus.find({ isActive: true, isArchived: false })
        .select("code label description displayOrder isDefault isTerminal isPlaceholder")
        .sort({ displayOrder: 1 })
        .lean(),
    ]);

    return jsonOk({
      programmes: programmes.map((p) => ({
        code: p.code,
        name: p.name,
        shortName: p.shortName ?? p.name,
      })),

      sources: sources.map((s) => ({
        code: s.code,
        label: s.label,
        // Exposed so the staff form can group the two unreconciled taxonomies
        // visibly instead of presenting thirteen flat options as one clean list.
        taxonomyGroup: s.taxonomyGroup,
      })),

      statuses: statuses.map((s) => ({
        code: s.code,
        label: s.label,
        description: s.description ?? null,
        isDefault: s.isDefault,
        isTerminal: s.isTerminal,
        isPlaceholder: s.isPlaceholder,
      })),
    });
  } catch {
    return jsonFail(ERROR_CODES.INTERNAL, "Could not load configuration.");
  }
}
