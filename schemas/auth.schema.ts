import { z } from "zod";

/**
 * Login validation — shared by the login form and the credential service.
 *
 * DELIBERATELY WEAK ON THE WAY IN. This schema checks *shape*, not strength: an
 * email that looks like an email, and a password long enough to be worth hashing.
 * A login form must never enforce password policy, because the only passwords it
 * ever sees were set elsewhere — and a rule like "must contain a digit" told to a
 * caller who typed the right password is both wrong and a hint about the format
 * of real credentials.
 *
 * `.strict()` for the same reason the enquiry schemas use it: a login request has
 * exactly two fields, and anything extra is either a bug or a probe. Notably it
 * stops a caller smuggling in `role` or `permissions` and hoping something
 * downstream spreads the parsed object.
 *
 * MAX LENGTHS ARE A DENIAL-OF-SERVICE CONTROL, not a usability one. bcrypt cost
 * scales with input, so an unbounded password field is a free way to make the
 * server do work. bcrypt itself only reads the first 72 bytes, so capping at 200
 * costs a real user nothing.
 */
export const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "Enter your email address.")
      .max(160, "That email address is too long.")
      .email("Enter a valid email address."),

    password: z
      .string()
      .min(1, "Enter your password.")
      .max(200, "That password is too long."),
  })
  .strict();

export type LoginInput = z.output<typeof loginSchema>;
export type LoginFormValues = z.input<typeof loginSchema>;
