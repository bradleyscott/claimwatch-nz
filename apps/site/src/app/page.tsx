import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { VERDICT_TONES } from "@/components/verdict-rule";
import { cn } from "@/lib/utils";
import { VERDICT_LABELS } from "@/lib/verdict-page";

// Feed: minimal by priority (Sept 2026) — a recency link list into
// the verdict pages. No facet rail; the verdict pages are the MVP's proof.
// Empty store renders the honest empty state (SIT-R14).

export const dynamic = "force-dynamic";

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Live store lands with the deployment slice; empty state is the honest one.
  const { getSiteStore, installLiveStore, readOptionsFromSearch } = await import(
    "@/lib/site-store"
  );
  if (process.env.SITE_STORE === "live" && process.env.DATABASE_URL) {
    installLiveStore(process.env.DATABASE_URL);
  }
  const store = getSiteStore();
  // Public record by default; `?corpus=all` shows the unprovenanced corpus.
  const { entries } = await store.getFeed(0, 20, readOptionsFromSearch(await searchParams));

  return (
    <main className="page-shell py-6">
      <h1 className="mt-4 text-[22px] font-extrabold tracking-tight">Live feed</h1>
      {entries.length === 0 ? (
        <Alert className="mt-6 px-6 py-5">
          <AlertTitle className="text-[15px]">No verdicts published yet</AlertTitle>
          <AlertDescription className="text-[15px]">
            The first checks are coming —{" "}
            <a className="font-semibold text-primary hover:underline" href="/methodology">
              how this works
            </a>
            .
          </AlertDescription>
        </Alert>
      ) : (
        <ul className="mt-4 space-y-3">
          {entries.map((entry) => (
            <li key={entry.claimId}>
              <a
                href={`/claim/${entry.claimId}`}
                className="block rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <Card className="gap-0 px-6 py-5 transition-colors hover:border-muted-foreground/40">
                  <span className="font-serif text-[20px] leading-snug">“{entry.claimText}”</span>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "mt-2 rounded-full px-3 py-1 text-[11.5px] font-bold",
                      VERDICT_TONES[entry.verdictClass].chip,
                    )}
                  >
                    {VERDICT_LABELS[entry.verdictClass].label}
                  </Badge>
                </Card>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
