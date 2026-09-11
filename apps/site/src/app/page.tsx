// Feed: minimal by priority (Bradley, Sept 2026) — a recency link list into
// the verdict pages. No facet rail; the verdict pages are the MVP's proof.
// Empty store renders the honest empty state (SIT-R14).

export const dynamic = "force-dynamic";

interface FeedItem {
  claimId: string;
  claimText: string;
  verdictClass: "supported" | "refuted" | "not_enough_evidence" | "conflicting_cherry_picking";
  publishedAt: Date;
}

const VERDICT_TONE: Record<FeedItem["verdictClass"], { label: string; color: string }> = {
  supported: { label: "Supported", color: "var(--v-sup)" },
  refuted: { label: "Refuted", color: "var(--v-ref)" },
  not_enough_evidence: { label: "Not enough evidence", color: "var(--v-nei)" },
  conflicting_cherry_picking: { label: "Accurate but incomplete", color: "var(--v-inc)" },
};

export default async function FeedPage() {
  // Live store lands with the deployment slice; empty state is the honest one.
  const { fixtureSiteStore } = await import("@/lib/site-store");
  const store = fixtureSiteStore([]);
  const { entries } = await store.getFeed(0, 20);

  return (
    <main className="mx-auto max-w-[820px] px-5 py-6">
      <h1 className="mt-4 text-[22px] font-extrabold tracking-tight">Live feed</h1>
      {entries.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-line bg-card p-8 text-[15px] text-mut">
          No verdicts published yet. The first checks are coming —{" "}
          <a className="font-semibold text-link" href="/methodology">
            how this works
          </a>
          .
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {entries.map((e) => (
            <li key={e.claimId}>
              <a
                href={`/claim/${e.claimId}`}
                className="block rounded-2xl border border-line bg-card px-6 py-5 hover:border-[#c9c2b4]"
              >
                <span className="font-quote text-[20px] leading-snug">“{e.claimText}”</span>
                <span
                  className="mt-2 inline-block rounded-full px-3 py-1 text-[11.5px] font-bold"
                  style={{
                    color: VERDICT_TONE[e.verdictClass]?.color,
                    background: "color-mix(in srgb, currentColor 12%, white)",
                  }}
                >
                  {VERDICT_TONE[e.verdictClass]?.label}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
