"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  publicEnquirySchema,
  type PublicEnquiryFormValues,
  type PublicEnquiryInput,
} from "@/schemas/enquiry.schema";

import { EnquireSuccess } from "./EnquireSuccess";
import type { SubmissionReceipt } from "./types";
import { useEnquiryConfig } from "./useEnquiryConfig";

/**
 * The public enquiry form — the one public surface in the system.
 *
 * DECISIONS THAT MATTER HERE, all of them tied to a rule rather than to taste:
 *
 * ONE SCHEMA. Validation comes from `publicEnquirySchema`, the same object the
 * route handler parses with. The user gets instant feedback and the server still
 * re-validates; neither can drift from the other.
 *
 * THE IDEMPOTENCY KEY IS GENERATED ONCE PER MOUNT, in a `useMemo` with no
 * dependencies. That is the whole point: a double-click, or a retry after a
 * timeout, sends the SAME key, so the API resolves it to the original record
 * instead of creating a second enquiry. Regenerating it per submit would defeat
 * the protection entirely.
 *
 * ENTERED DATA SURVIVES A FAILURE. On an error the form keeps every value and
 * shows what went wrong. Clearing a parent's typed enquiry because the database
 * blinked is silent data loss at the UI layer.
 *
 * NOTHING ABOUT DUPLICATES IS SHOWN. Not a warning, not a hint. The API does not
 * send it, and this form does not ask.
 */
export function EnquireForm() {
  const { config, error: configError, loading, retry } = useEnquiryConfig();

  const [receipt, setReceipt] = useState<SubmissionReceipt | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Once per mount. Never regenerated. See the note above.
  const idempotencyKey = useMemo(
    () =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    [],
  );

  // Three generics: the values the FIELDS hold, the form context, and the parsed
  // values `handleSubmit` hands to onSubmit. They differ because of the email
  // transform — see the note in schemas/enquiry.schema.ts.
  const form = useForm<PublicEnquiryFormValues, unknown, PublicEnquiryInput>({
    resolver: zodResolver(publicEnquirySchema),
    // Controlled from the start, so a failed submission has real values to keep
    // rather than a mix of undefined and empty.
    defaultValues: {
      fullName: "",
      phone: "",
      email: "",
      programmeCode: "",
      message: "",
      previousInstitution: "",
      hscStream: "",
      hscPercentageBand: "",
      city: "",
    },
  });

  async function onSubmit(values: PublicEnquiryInput) {
    setSubmitError(null);

    try {
      const res = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, idempotencyKey }),
      });

      const body = await res.json();

      if (!res.ok || !body.success) {
        // Field-level errors from the server are mapped back onto the form, so a
        // rule the client did not catch still lands on the right input.
        if (body?.details && typeof body.details === "object") {
          for (const [field, message] of Object.entries(
            body.details as Record<string, string>,
          )) {
            form.setError(field as keyof PublicEnquiryFormValues, {
              type: "server",
              message,
            });
          }
        }

        setSubmitError(
          body?.message ?? "We could not save your enquiry. Nothing was recorded — please try again.",
        );
        return;
      }

      // Only now — the API returned success, which it only does after the database
      // confirmed the write.
      setReceipt(body.data as SubmissionReceipt);
    } catch {
      setSubmitError(
        "We could not reach the server. Your enquiry was NOT saved — please check your connection and try again.",
      );
    }
  }

  if (receipt) return <EnquireSuccess receipt={receipt} />;

  if (loading) {
    return (
      // Field-shaped placeholders, so the form does not jump when the programme list
      // arrives. The visible text is for screen readers, which the skeleton itself
      // is deliberately hidden from.
      <div className="space-y-6">
        <p className="sr-only" role="status">
          Loading the enquiry form.
        </p>
        {[0, 1, 2].map((index) => (
          <Card key={index} className="p-6">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-4 h-9 w-full" />
            <Skeleton className="mt-4 h-9 w-2/3" />
          </Card>
        ))}
      </div>
    );
  }

  if (configError || !config) {
    return (
      <Alert variant="destructive">
        <AlertTitle>The form could not load</AlertTitle>
        <AlertDescription>
          <p>{configError}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={retry}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
        {/* ── Section 1: who to contact ──────────────────────────────────────── */}
        <Section
          title="Your details"
          description="So the admissions team can reach you about this enquiry."
        >
        <FormField
          control={form.control}
          name="fullName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full name</FormLabel>
              <FormControl>
                <Input placeholder="Your full name" autoComplete="name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-6 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Mobile number</FormLabel>
                <FormControl>
                  <Input
                    type="tel"
                    inputMode="tel"
                    placeholder="98765 43210"
                    autoComplete="tel"
                    {...field}
                  />
                </FormControl>
                <FormDescription>We will call you on this number.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                {/* Optional, and said so plainly — a required email pushes people
                    into inventing one, which corrupts duplicate matching. */}
                <FormLabel>
                  Email <span className="font-normal text-muted-foreground">(optional)</span>
                </FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        </Section>

        {/* ── Section 2: what they are asking about ──────────────────────────── */}
        <Section
          title="Your interest"
          description="Which programme, and anything you would like the team to know."
        >
        <FormField
          control={form.control}
          name="programmeCode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Programme you are interested in</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a programme" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {/* Straight from the database. Nothing about the seven
                      programmes is hardcoded in this component. */}
                  {config.programmes.map((programme) => (
                    <SelectItem key={programme.code} value={programme.code}>
                      {programme.shortName} — {programme.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                Enquiring about more than one programme? Submit the form once for each — they are
                tracked separately.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="city"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                City <span className="font-normal text-muted-foreground">(optional)</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="Mumbai" autoComplete="address-level2" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="message"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Anything else{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </FormLabel>
              <FormControl>
                <Textarea
                  rows={4}
                  placeholder="Questions about fees, timings, eligibility…"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        </Section>

        {/* ── Unconfirmed placeholder fields ────────────────────────────────────
            SCCT has not confirmed which qualification details they need (open
            question 3). These are labelled as placeholders IN THE UI, not just in
            the README, so nobody demonstrating this can mistake them for a
            confirmed requirement. */}
        {/* <fieldset className="space-y-4 rounded-lg border border-dashed bg-muted/30 p-5">
          <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Placeholder fields — pending SCCT confirmation
          </legend>

          <p className="text-xs text-muted-foreground">
            These example fields are not confirmed SCCT requirements. All are optional and none
            affect how your enquiry is handled.
          </p>

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField
              control={form.control}
              name="previousInstitution"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Previous school / college</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="hscStream"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>HSC stream</FormLabel>
                  <FormControl>
                    <Input placeholder="Commerce / Science / Arts" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="hscPercentageBand"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>HSC percentage</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. 60–70%" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </fieldset> */}

        {submitError && (
          <Alert variant="destructive">
            <AlertTitle>{submitError}</AlertTitle>
            <AlertDescription className="text-muted-foreground">
              Everything you typed has been kept — press submit to try again.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={form.formState.isSubmitting} size="lg">
            {form.formState.isSubmitting ? "Submitting…" : "Submit enquiry"}
          </Button>

          <p className="text-xs text-muted-foreground">
            Used only to contact you about this enquiry.
          </p>
        </div>
      </form>
    </Form>
  );
}

/**
 * A labelled group of fields.
 *
 * Nine inputs in one undifferentiated column reads as a long form; the same nine in
 * three named groups reads as three short questions. That is the entire reason this
 * exists — it changes how much work the form appears to be, which is what decides
 * whether a parent finishes it.
 *
 * A real `<fieldset>` with a `<legend>`, not a styled div: it is what tells a screen
 * reader that these inputs belong together, and it is free.
 */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card asChild>
      <fieldset className="p-5 sm:p-6">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      <p className="mb-5 mt-1 text-xs text-muted-foreground">{description}</p>
        <div className="space-y-6">{children}</div>
      </fieldset>
    </Card>
  );
}
