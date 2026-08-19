/**
 * The shape of what `GET /api/config` returns, as this feature consumes it.
 *
 * Declared here rather than imported from the route: the route's response is an
 * API contract, and the form should break loudly at compile time if that contract
 * changes shape — not silently inherit whatever the handler happens to return.
 */

export type ProgrammeOption = {
  code: string;
  name: string;
  shortName: string;
};

export type SourceOption = {
  code: string;
  label: string;
  taxonomyGroup: "route_analysis" | "source_analysis" | "canonical";
};

export type StatusOption = {
  code: string;
  label: string;
  description: string | null;
  isDefault: boolean;
  isTerminal: boolean;
  isPlaceholder: boolean;
};

export type EnquiryConfig = {
  programmes: ProgrammeOption[];
  sources: SourceOption[];
  statuses: StatusOption[];
};

/** What the form shows after a successful submission. */
export type SubmissionReceipt = {
  enquiryNumber: string;
  message: string;
};
