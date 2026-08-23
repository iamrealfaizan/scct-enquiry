"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Sign out.
 *
 * `callbackUrl` IS SET EXPLICITLY. Auth.js defaults to the current page, which is
 * a staff page — so the browser would land on a protected URL with no cookie, get
 * redirected to `/login?next=…`, and the user would appear to have signed out into
 * a login form that then wants to send them back where they came from. Going
 * straight to `/login` is the behaviour someone clicking this expects.
 *
 * DISABLED WHILE IN FLIGHT, not because a double click breaks anything — signing
 * out twice is harmless — but because a button that looks inert while the request
 * runs invites the click that produces a confusing double navigation.
 */
export function SignOutButton() {
  const [pending, setPending] = useState(false);

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      /**
       * Overridden for the navy shell. The default `outline` variant is a dark
       * border with foreground text — on a navy background that is dark-on-dark and
       * effectively invisible. Written against the primary-foreground token rather
       * than a literal white so the dark-mode palette still governs it.
       */
      className="w-full border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground lg:w-full"
      onClick={() => {
        setPending(true);
        void signOut({ callbackUrl: "/login" });
      }}
    >
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
