import { Search } from "lucide-react";
import type { Metadata } from "next";
import "./globals.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = {
  title: { default: "ClaimWatch NZ", template: "%s — ClaimWatch NZ" },
  description: "Checking claims made in New Zealand politics against the official data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NZ">
      <body className="min-h-screen antialiased">
        <header className="bg-foreground text-background">
          <div className="mx-auto flex max-w-[820px] flex-wrap items-center gap-2 px-5 py-2.5 sm:gap-4">
            <a
              href="/"
              className="flex items-center gap-1.5 text-[19px] font-extrabold tracking-tight"
            >
              ClaimWatch
              <Badge
                variant="secondary"
                className="border-transparent bg-primary/30 px-1.5 text-background text-xs"
              >
                NZ
              </Badge>
            </a>
            <nav className="flex items-center gap-1">
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="text-background/70 hover:bg-background/10 hover:text-background"
              >
                <a href="/">Live feed</a>
              </Button>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="font-semibold text-background hover:bg-background/10 hover:text-background"
              >
                <a href="/methodology">How this works</a>
              </Button>
            </nav>
            {/* Decorative until site search ships (SITE-MVP open question 5) — rendered
                disabled rather than as a live-looking box that does nothing. */}
            <div className="relative ml-auto hidden sm:block">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-background/50"
              />
              <Input
                disabled
                aria-label="Search a claim, person, or topic"
                title="Search is not available yet"
                placeholder="Search a claim, person, or topic…"
                className="h-8 w-[210px] border-background/20 bg-background/10 pl-8 text-[13px] text-background placeholder:text-background/50"
              />
            </div>
          </div>
        </header>
        {children}
        <footer className="px-5 pt-8 pb-10 text-center text-xs text-faint">
          Verdicts are produced by an automated pipeline; data tables, prompt versions and audit
          results are logged and public.
        </footer>
      </body>
    </html>
  );
}
