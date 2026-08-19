import { z } from "zod";

/**
 * Environment validation, run once at import time.
 *
 * Two deliberate choices, both defensible:
 *
 * 1. Secrets are REQUIRED with no default. A missing value fails immediately and
 *    loudly, rather than producing a confusing runtime failure later — or worse,
 *    silently connecting somewhere unintended.
 * 2. This module is server-only. Importing it from a client component is a bug,
 *    because doing so would be an attempt to ship secrets to the browser, so it
 *    throws rather than failing quietly.
 *
 * Only NEXT_PUBLIC_* values are safe in the browser, and those are exported
 * separately as `publicEnv`.
 */

if (typeof window !== "undefined") {
  throw new Error(
    "lib/env.ts is server-only and must not be imported from client code. " +
      "Use `publicEnv` for NEXT_PUBLIC_* values instead.",
  );
}

const serverSchema = z.object({
  // Accepts either scheme Atlas hands out. Not validated as a URL: a
  // mongodb+srv:// connection string is not a conventional URL and z.url()
  // rejects perfectly valid ones.
  MONGODB_URI: z
    .string()
    .min(1, "MONGODB_URI is required")
    .refine(
      (v) => v.startsWith("mongodb://") || v.startsWith("mongodb+srv://"),
      "MONGODB_URI must start with mongodb:// or mongodb+srv://",
    ),

  MONGODB_DB: z.string().min(1, "MONGODB_DB is required"),

  // 32 chars is the floor for a signing secret worth having.
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters")
    .refine(
      (v) => !v.startsWith("REPLACE_"),
      "SESSION_SECRET still holds the .env.example placeholder — generate a real one",
    ),

  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().min(1, "NEXT_PUBLIC_APP_URL is required"),
});

function parseOrExit<T extends z.ZodType>(schema: T, source: unknown, label: string): z.infer<T> {
  const result = schema.safeParse(source);

  if (!result.success) {
    // Print the field names that failed, never the values — an env var that
    // failed validation may itself be a secret.
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Invalid ${label} environment configuration:\n${problems}\n\n` +
        `Copy .env.example to .env.local and fill in the missing values.`,
    );
  }

  return result.data;
}

export const env = parseOrExit(
  serverSchema,
  {
    MONGODB_URI: process.env.MONGODB_URI,
    MONGODB_DB: process.env.MONGODB_DB,
    SESSION_SECRET: process.env.SESSION_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  },
  "server",
);

export const publicEnv = parseOrExit(
  publicSchema,
  {
    // Must be referenced statically by full name — Next inlines NEXT_PUBLIC_*
    // at build time and cannot resolve a dynamic lookup.
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  "public",
);

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
