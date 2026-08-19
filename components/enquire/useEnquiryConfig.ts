"use client";

import { useEffect, useState } from "react";

import type { EnquiryConfig } from "./types";

/**
 * Load the dropdown configuration.
 *
 * This hook IS the feature's service layer — there is no frontend `services/`
 * folder. It owns the fetch, the envelope unwrapping and the three states the
 * component actually renders.
 *
 * `AbortController` on unmount, and an aborted request is treated as SUPERSEDED,
 * NOT FAILED. The distinction matters: React 18 in development mounts every
 * component twice, so without it the first request aborts and the form would show
 * a configuration error on every page load.
 *
 * On failure `config` is null and `error` is set. The form must not render a
 * partly-populated dropdown — an empty programme list that looks like "SCCT offers
 * nothing" is worse than an explicit "could not load" with a retry.
 */
export function useEnquiryConfig() {
  const [config, setConfig] = useState<EnquiryConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/config", {
          signal: controller.signal,
          cache: "no-store",
        });

        const body = await res.json();

        if (!res.ok || !body.success) {
          setConfig(null);
          setError(body?.message ?? "Could not load the enquiry form options.");
          return;
        }

        // The envelope is unwrapped here, at the hook boundary. Components never
        // see `success`/`data`.
        setConfig(body.data as EnquiryConfig);
      } catch (err) {
        // Superseded, not failed.
        if (controller.signal.aborted) return;

        setConfig(null);
        setError(
          err instanceof Error && err.message
            ? "Could not load the enquiry form options."
            : "Could not load the enquiry form options.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();

    return () => controller.abort();
  }, [reloadToken]);

  return {
    config,
    error,
    loading,
    retry: () => setReloadToken((n) => n + 1),
  };
}
