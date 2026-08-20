import type { Config } from "tailwindcss";

/**
 * Tailwind is wired to the CSS variables declared in app/globals.css, not to
 * literal colours. That is what makes `bg-background`, `text-muted-foreground`
 * and `border-destructive` mean one thing across the public form and the staff
 * interface, and what keeps a theme change out of the components.
 *
 * `darkMode: "class"` rather than the media query: the token block in
 * globals.css is scoped to `.dark`, so the app follows an explicit class. There
 * is no theme toggle in the trial scope — this leaves the door open without
 * building it.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        // Semantic state colours. Registered here so `bg-success`, `text-warning`
        // and `border-success/40` resolve like any other token — without this a
        // component would have to reach for a raw Tailwind colour, which is the
        // one thing the token system exists to prevent.
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        /**
         * Inter for reading, JetBrains Mono for identifiers. See app/layout.tsx
         * for why each was chosen.
         *
         * The fallback stacks are not decoration: `display: "swap"` means the
         * fallback is what a visitor sees for the first few hundred milliseconds,
         * so it should be a system face with similar metrics rather than whatever
         * the browser defaults to. `system-ui` resolves to Segoe UI on the
         * Windows machines SCCT's staff use.
         */
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Consolas", "monospace"],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  // Required by the radix-backed primitives (select, dialog) for their
  // enter/exit states. Present because a component needs it, not by default.
  plugins: [require("tailwindcss-animate")],
};

export default config;
