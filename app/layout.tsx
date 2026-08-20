import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * Two typefaces, and each has a job.
 *
 * INTER for everything a person reads. It has the largest x-height of the
 * realistic candidates, which is what keeps the 12px text in the queue legible
 * rather than merely present, and it ships proper tabular figures — the queue sorts
 * and scans columns of numbers, and digits that do not line up turn a column into
 * prose you have to read.
 *
 * JETBRAINS MONO for identifiers only: enquiry numbers, permission codes, staff
 * profile ids. Chosen over the other monos because its `0/O`, `1/l/I` and `8/B` are
 * unambiguous — someone reads "ENQ-2026-000041" down a phone line to a parent, and
 * a mono that renders zero without a distinguishing mark makes that call harder than
 * it needs to be.
 *
 * WHY `next/font/google` RATHER THAN THE COMMITTED .woff FILES this replaced. Next
 * downloads both faces at BUILD time and self-hosts them from our own origin, so:
 * no request to Google at runtime, nothing for a visitor's browser to leak, no
 * external dependency during a live demo, and no layout shift because the metrics
 * are known at build. It also means the repository holds no binary font assets.
 *
 * `display: "swap"` shows text in the fallback immediately rather than holding a
 * blank page. On a college's connection, text you can read in the wrong font beats
 * text you cannot read at all.
 *
 * SUBSET `latin` ONLY, deliberately. Names in the demo data are Latin-script. If
 * SCCT needs Devanagari for student names, that is a subset to add here — and it is
 * a real question rather than an assumption, so it is not silently included.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SCCT Enquiry System",
  description:
    "Admissions enquiry system of record — technical trial build with synthetic data only.",
  // Not SCCT's live site, so it must not be indexed as though it were.
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
