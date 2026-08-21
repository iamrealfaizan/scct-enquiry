"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { loginSchema, type LoginFormValues } from "@/schemas/auth.schema";

import { LOGIN_FALLBACK_MESSAGE, LOGIN_MESSAGES } from "./types";

/**
 * The staff login form.
 *
 * `redirect: false` ON `signIn`, DELIBERATELY. Letting Auth.js perform the
 * redirect means a failed attempt comes back as a full page load with `?error=` in
 * the URL, which loses the typed email and puts an error code in the address bar.
 * Handling the result here keeps the form's state and lets the failure be
 * explained in a sentence rather than a code.
 *
 * THE PASSWORD FIELD IS NEVER REPOPULATED and never logged. On failure the email
 * is kept — retyping it is pure friction — and the password is cleared, because
 * the overwhelmingly likely reason for being here is that it was wrong.
 *
 * `router.refresh()` BEFORE NAVIGATING. The staff pages are server components that
 * read the session; without a refresh, Next may serve a cached render from before
 * the cookie existed, and the user lands on their own queue as though they were
 * still anonymous.
 */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginFormValues) {
    setError(null);

    try {
      const result = await signIn("credentials", {
        email: values.email,
        password: values.password,
        redirect: false,
      });

      if (!result || result.error) {
        // `code` is what `LoginError` carried out of `authorize`. It can legitimately
        // be absent — an Auth.js internal failure has no code of ours — so the
        // fallback is not defensive padding, it is the real other case.
        const code = (result as { code?: string } | undefined)?.code;

        setError((code && LOGIN_MESSAGES[code]) || LOGIN_FALLBACK_MESSAGE);
        form.resetField("password");
        return;
      }

      router.refresh();
      router.push(next);
    } catch {
      // A thrown fetch means the request never reached the server, which is a
      // different fact from "your details were rejected" and must read differently.
      setError("We could not reach the server. Please check your connection and try again.");
      form.resetField("password");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="username"
                  placeholder="you@demo.scct-enquiry.local"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {error && (
          <Alert variant="destructive">
            <AlertDescription className="font-medium">{error}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
          {form.formState.isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </Form>
  );
}
