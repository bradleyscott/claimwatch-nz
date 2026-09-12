import { claimReviewFromVerdict } from "@cw/store";
import { VerdictRule } from "@/components/verdict-rule";
import { anchorHref, buildVerdictPageModel } from "@/lib/verdict-page";

// The verdict page: the MVP's proof (Bradley's priority). SSR atom — verdict
// content and ClaimReview JSON-LD in the initial HTML (SIT-R8), fixed section
// order (§2.3), register-safe copy (§2.2).

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: "Verdict" };
}

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { getSiteStore, installLiveStore } = await import("@/lib/site-store");
  if (process.env.SITE_STORE === "live" && process.env.DATABASE_URL) {
    // Schema is guaranteed current by the startup migration step
    // (drizzle-kit migrate in the service entrypoint) — the page just reads.
    installLiveStore(process.env.DATABASE_URL);
  }
  const data = await getSiteStore().getVerdictPage(id);
  if (!data) {
    return (
      <main className="mx-auto max-w-[820px] px-5 py-10">
        <div className="rounded-2xl border border-line bg-card p-8">
          <p className="text-[15px] text-mut">
            We could not find that claim. It may not be checked yet —{" "}
            <a className="font-semibold text-link" href="/">
              back to the live feed
            </a>
            .
          </p>
        </div>
      </main>
    );
  }

  const model = buildVerdictPageModel({
    claimId: data.claimId,
    claimText: data.claimText,
    speaker: data.speaker,
    speakerAffiliation: data.speakerAffiliation,
    publishedAt: data.publishedAt,
    verdictClass: data.verdictClass,
    confidence: data.confidence,
    attachedProposal: data.attachedProposal,
    mediaAnchor: data.mediaAnchor,
    transcriptTier: data.transcriptTier,
    evidence: data.evidence,
    pipelineVersion: data.pipelineVersion,
    promptVersions: data.promptVersions,
  });

  // The discovery channel (SIT-R1): one ClaimReview per verdict page, rendered
  // server-side in the initial HTML — Google Fact Check Explorer reads this.
  const claimReview = claimReviewFromVerdict({
    verdictUrl: `https://claimwatch.nz/claim/${data.claimId}`,
    claimText: data.claimText,
    verdictClass: data.verdictClass,
    publishedAt: data.publishedAt.toISOString(),
    claimPublishedAt: data.publishedAt.toISOString(),
    claimantName: data.speaker ?? "Unknown",
    claimantKind: data.speaker ? "person" : "unknown",
    ...(data.mediaAnchor ? { mediaAnchor: data.mediaAnchor } : {}),
  });

  return (
    <main className="mx-auto max-w-[820px] px-5 py-6">
      <script
        type="application/ld+json"
        // SIT-R1: the serializer is validated by the shared corpus tests; a
        // malformed payload here must fail the build, not silently vanish.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(claimReview) }}
      />
      {/* Breadcrumbs (mockup: Live feed › Topic › Claims by speaker) — topic
          facets land with the entity slice; the feed link is live now. */}
      <div className="pb-2 pt-1 text-[12.5px] text-mut">
        <a href="/" className="hover:text-ink">
          Live feed
        </a>{" "}
        › Verdict
      </div>
      <section
        className="mt-4 rounded-2xl border border-line bg-card px-7 py-7"
        aria-label="The claim"
      >
        <div className="mb-4 text-[11px] font-extrabold uppercase tracking-[.12em] text-faint">
          The claim
        </div>
        <blockquote className="font-quote text-[30px] leading-[1.27] tracking-[-.01em]">
          “{data.claimText}”
        </blockquote>
        <div className="mt-4 text-[13.5px] text-mut">
          {data.speaker ? (
            <>
              <b className="font-semibold text-[#3c4654]">{data.speaker}</b>
              {data.speakerAffiliation ? <>, {data.speakerAffiliation}</> : null}
              <span className="mx-1.5 text-[#c6cad1]">·</span>
              {data.publishedAt.toLocaleDateString("en-NZ", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </>
          ) : null}
        </div>
      </section>

      {/* Verdict card — amber surface, rule + pin, plain verdict */}
      <section
        className="mt-4 rounded-2xl border border-[#eddfc2] bg-[#fdf8ef] px-7 py-7"
        aria-label="Our verdict"
      >
        <VerdictRule verdictClass={data.verdictClass} />
        <div className="mt-5 text-[38px] font-extrabold leading-[1.02] tracking-[-.025em] text-[#8a5a12]">
          {model.label}
        </div>
        <p className="mt-2 max-w-[620px] text-[19px] font-semibold leading-[1.42] text-[#33270f]">
          {model.plainSummary}
        </p>
        {data.attachedProposal ? (
          <p className="mt-3 border-l-[3px] border-[#eddfc2] pl-3 text-[12.5px] text-[#8a5a12]">
            Checked as support for: {data.attachedProposal}
          </p>
        ) : null}
        <p className="mt-2 text-[12.5px] text-[#a58a55]">
          Confidence: {Math.round(data.confidence * 100)}%
        </p>
      </section>

      {/* Hear it / watch it — rendered iff anchor present (SIT-R3) */}
      {data.mediaAnchor ? (
        <section className="mt-4" aria-label="Hear the claim">
          <a
            href={anchorHref(data.mediaAnchor)}
            className="flex items-center gap-4 rounded-2xl bg-[#0d1a2b] px-5 py-4 text-[#dfe6ee]"
          >
            <span
              aria-hidden="true"
              className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-link text-white"
            >
              ▶
            </span>
            <span className="text-[13.5px] text-[#dfe6ee]">
              <b className="text-[14.5px] text-white">Hear the claim</b> — jumps to the moment it
              was said
            </span>
          </a>
          {data.transcriptTier === "publisher-auto" ? (
            <p className="mt-3 text-[12.5px] text-mut">
              The wording above comes from an automatically generated transcript, which can contain
              errors.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Evidence */}
      <section
        className="mt-4 rounded-2xl border border-line bg-card px-7 py-7"
        aria-label="The evidence"
      >
        <div className="mb-4 text-[11px] font-extrabold uppercase tracking-[.12em] text-faint">
          What we checked it against
          <span className="ml-2.5 font-semibold normal-case tracking-normal text-[#b3b9c0]">
            public · re-runnable
          </span>
        </div>
        {data.justifications.length > 0 ? (
          <div className="mb-3 space-y-2 border-l-[3px] border-line pl-4">
            {data.justifications.map((j, i) => (
              <p key={i} className="text-[15.5px] font-semibold leading-relaxed text-[#33270f]">
                {j}
              </p>
            ))}
          </div>
        ) : null}
        {data.evidence.length === 0 ? (
          <p className="text-[15px] text-mut">
            {data.verdictClass === "not_enough_evidence"
              ? "We could not verify this claim with the evidence available. If you know of an official source, tell us."
              : "No external evidence was needed for this check."}
          </p>
        ) : (
          data.evidence.map((e) => (
            <div
              key={e.seriesIdentity}
              className="grid grid-cols-[150px_1fr] gap-5 border-t border-line py-4"
            >
              <div className="pt-0.5 text-[11px] font-extrabold uppercase tracking-[.08em] text-faint">
                {e.authorityRef}
              </div>
              <div>
                <b className="text-[15.5px] font-bold">
                  {e.url ? (
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#155cc4] hover:underline"
                    >
                      {e.seriesIdentity}
                    </a>
                  ) : (
                    e.seriesIdentity
                  )}
                </b>
                <p className="mt-1 text-[13.5px] leading-relaxed text-mut">{e.plainReason}</p>
                <p className="mt-1 font-calc text-[12px] text-[#b3b9c0]">
                  as measured at {e.vintageDate}
                </p>
              </div>
            </div>
          ))
        )}
      </section>
      {/* Provenance — collapsed by default, the one place technical vocabulary is permitted */}
      <details className="mt-4 rounded-2xl border border-line bg-card px-7 py-4 text-[12px] text-[#8a919b]">
        <summary className="cursor-pointer text-[11px] font-extrabold uppercase tracking-[.08em] text-faint">
          How this verdict was made
        </summary>
        <p className="mt-3">
          Pipeline version {data.pipelineVersion}. Prompt versions:{" "}
          {Object.entries(data.promptVersions)
            .map(([k, v]) => `${k}@${v}`)
            .join(", ")}
          {Object.keys(data.modelVersions).length > 0
            ? ` · Models: ${Object.entries(data.modelVersions)
                .map(([k, v]) => `${k}: ${v}`)
                .join(", ")}`
            : ""}
          {data.searchRefs.length > 0
            ? ` · Search queries recorded: ${data.searchRefs.length}`
            : ""}
          {data.transcriptTier ? ` · transcript tier: ${data.transcriptTier}` : ""}.
        </p>
      </details>

      {/* Metarow + contest (mockup footer material). The contest flow names
          the future contestation slice without building it (SITE-MVP
          out-of-scope note). */}
      <div className="mt-4 flex flex-wrap gap-4 px-2 text-[12.5px] text-mut">
        <span>
          Checked{" "}
          {data.publishedAt.toLocaleDateString("en-NZ", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
        <span>·</span>
        <a href="/methodology" className="text-[#155cc4] no-underline hover:underline">
          How we check claims
        </a>
      </div>
      <p className="mt-3 border-l border-dashed border-line pl-4 text-[12px] text-[#8a919b]">
        <b>How this verdict was made:</b> produced by our automated pipeline ({data.pipelineVersion}
        ) and quality-audited. Data tables, prompt versions and audit results are logged and public.
      </p>
      <p className="mt-4 text-[15px]">
        <b className="font-extrabold">Think we&apos;ve got this wrong?</b>{" "}
        <a
          href="/methodology"
          className="font-semibold text-[#155cc4] no-underline hover:underline"
        >
          Tell us
        </a>{" "}
        — with a source we should have used. Contests are public, and when one checks out we change
        the verdict and show the change history.
      </p>
    </main>
  );
}
