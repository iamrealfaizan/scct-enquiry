/**
 * Contact normalisation, used for duplicate matching only.
 *
 * The stored `phone`/`email` keep exactly what was submitted, because that is
 * what staff read back to the person. These derived values exist so that
 * "+91 98765 43210", "098765 43210" and "9876543210" are recognised as the same
 * person — which raw string matching would miss, silently, and the duplicate rule
 * would be worthless.
 *
 * Deliberately narrow: Indian mobile numbers, because SCCT is a Mumbai college
 * and every enquiry route in the brief is local. A general phone-number library
 * would be a dependency carrying 200 countries of rules for a system that needs
 * one. If SCCT confirms international enquiries, that is the moment to add it.
 */

export function normalisePhone(input: string): string {
  const digits = input.replace(/\D/g, "");

  // +91 98765 43210 → 9876543210
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);

  // 098765 43210 → 9876543210 (the old STD-prefix habit)
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);

  // 0091... → 9876543210
  if (digits.length === 13 && digits.startsWith("0091")) return digits.slice(4);

  return digits;
}

/**
 * Lowercase and trim. Nothing more.
 *
 * Gmail dot- and plus-stripping is deliberately NOT done: treating
 * `a.b@gmail.com` and `ab@gmail.com` as the same person is a guess, it is
 * provider-specific, and being wrong here means flagging two different people as
 * duplicates of each other. Under-matching is recoverable; wrongly linking two
 * people's records is not.
 */
export function normaliseEmail(input: string): string {
  return input.trim().toLowerCase();
}

/** A valid Indian mobile number after normalisation: 10 digits, starting 6–9. */
export function isValidIndianMobile(normalised: string): boolean {
  return /^[6-9]\d{9}$/.test(normalised);
}
