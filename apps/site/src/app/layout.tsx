import type { Metadata } from "next";
import "./globals.css";
import { FeedbackWidget } from "@/components/feedback-widget";

export const metadata: Metadata = {
  title: { default: "ClaimWatch NZ", template: "%s — ClaimWatch NZ" },
  description: "Checking claims made in New Zealand politics against the official data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NZ">
      <body className="min-h-screen bg-paper text-ink antialiased">
        <header className="bg-ink text-white">
          <div className="mx-auto flex max-w-[820px] items-center gap-6 px-5 py-3">
            <a href="/" className="text-[19px] font-extrabold tracking-tight text-white">
              ClaimWatch <span className="text-[#8fb8d8]">NZ</span>
            </a>
            <nav className="flex gap-4 text-sm text-[#c3cad4]">
              <a href="/" className="hover:text-white">
                Live feed
              </a>
              <a href="/methodology" className="font-semibold text-white">
                How this works
              </a>
            </nav>
          </div>
        </header>
        {children}
        <FeedbackWidget pageUrl="/" />
        <footer className="px-5 pb-10 pt-8 text-center text-xs text-[#a5abb4]">
          Verdicts are produced by an automated pipeline; data tables, prompt versions and audit
          results are logged and public.
        </footer>
      </body>
    </html>
  );
}
