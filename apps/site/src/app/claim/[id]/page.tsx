import { claimReviewFromVerdict } from "@cw/store";
import { Fragment } from "react";
import { EvidenceSourceKey } from "@/components/evidence-source-key";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { VERDICT_TONES, VerdictRule } from "@/components/verdict-rule";
import {
  describeEvidenceSource,
  evidenceSourceCodes,
  orderEvidenceBySourceQuality,
} from "@/lib/evidence-source-labels";
import { cn } from "@/lib/utils";
import { anchorHref, buildVerdictPageModel } from "@/lib/verdict-page";

// The verdict page: the MVP's proof. SSR atom — verdict
// content and ClaimReview JSON-LD in the initial HTML (SIT-R8), fixed section
// order (§2.3), register-safe copy (§2.2).

export async function generateMetadata() {
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
      <main className="page-shell py-10">
        <Alert className="px-6 py-5">
          <AlertTitle className="text-[15px]">We could not find that claim</AlertTitle>
          <AlertDescription className="text-[15px]">
            It may not be checked yet —{" "}
            <a className="font-semibold text-primary hover:underline" href="/">
              back to the live feed
            </a>
            .
          </AlertDescription>
        </Alert>
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

  const tone = VERDICT_TONES[data.verdictClass];

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

  const justifications = data.justifications.filter((j) => !j.startsWith("Deep research checked"));

  // Strongest source first (SITE-MVP §2.3): the reader should meet the series
  // that settles the claim before the commentary about it. Sorting is by stored
  // source code; rows the check could not classify sink to the bottom.
  const evidence = orderEvidenceBySourceQuality(data.evidence);

  // Raw source codes for the provenance block only — the evidence list renders
  // their plain-language descriptions (SITE-MVP §2.2 rule 4, SIT-R4).
  const sourceCodes = evidenceSourceCodes(evidence);

  return (
    <main className="page-shell py-6">
      {/* SIT-R1: the discovery channel — the payload must be in the initial HTML. */}
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: inlining the ClaimReview payload into the initial HTML IS the discovery channel (SIT-R1) — the value is a schema-validated object serialized by our own code, never user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(claimReview) }}
      />
      {/* Breadcrumbs (mockup: Live feed › Topic › Claims by speaker) — topic
          facets land with the entity slice; the feed link is live now. */}
      <nav aria-label="Breadcrumb" className="pt-1 pb-2 text-[12.5px] text-muted-foreground">
        <a className="hover:text-foreground" href="/">
          Live feed
        </a>{" "}
        › Verdict
      </nav>

      <Card className="mt-4 gap-0 px-7 py-7" aria-label="The claim">
        <div className="microlabel mb-4">The claim</div>
        <blockquote className="font-serif text-[30px] leading-[1.27] tracking-[-.01em]">
          “{data.claimText}”
        </blockquote>
        {data.speaker ? (
          <div className="mt-4 text-[13.5px] text-muted-foreground">
            <b className="font-semibold text-foreground">{data.speaker}</b>
            {data.speakerAffiliation ? <>, {data.speakerAffiliation}</> : null}
            <span className="mx-1.5 text-border">·</span>
            {data.publishedAt.toLocaleDateString("en-NZ", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </div>
        ) : null}
      </Card>

      {/* Verdict card — surface, rule and ink all keyed to the verdict class */}
      <Card className={cn("mt-4 gap-0 px-7 py-7", tone.surface)} aria-label="Our verdict">
        <VerdictRule verdictClass={data.verdictClass} />
        <div
          className={cn(
            "mt-5 text-[38px] leading-[1.02] font-extrabold tracking-[-.025em]",
            tone.ink,
          )}
        >
          {model.label}
        </div>
        <p className="mt-2 max-w-[620px] text-[19px] leading-[1.42] font-semibold">
          {model.plainSummary}
        </p>
        {data.attachedProposal ? (
          <p className={cn("mt-3 border-l-[3px] border-current/30 pl-3 text-[12.5px]", tone.ink)}>
            Checked as support for: {data.attachedProposal}
          </p>
        ) : null}
        {justifications.length > 0 ? (
          <div className="mt-3 space-y-2 border-border">
            {justifications.map((justification) => (
              <p key={justification} className="text-[16px] leading-relaxed">
                {justification}
              </p>
            ))}
          </div>
        ) : null}
      </Card>

      {/* Hear it / watch it — rendered iff anchor present (SIT-R3) */}
      {data.mediaAnchor ? (
        <section className="mt-4" aria-label="Hear the claim">
          <a
            href={anchorHref(data.mediaAnchor)}
            className="block rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Card className="flex-row items-center gap-4 border-transparent bg-media-surface px-5 py-4 text-media-foreground shadow-none transition-colors hover:bg-media-surface/90">
              <span
                aria-hidden="true"
                className="flex size-11 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground"
              >
                ▶
              </span>
              <span className="text-[13.5px]">
                <b className="text-[14.5px] text-background">Hear the claim</b> — jumps to the
                moment it was said
              </span>
            </Card>
          </a>
          {data.transcriptTier === "publisher-auto" ? (
            <p className="mt-3 text-[12.5px] text-muted-foreground">
              The wording above comes from an automatically generated transcript, which can contain
              errors.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Evidence */}
      <Card className="mt-4 gap-0 px-7 py-7" aria-label="The evidence">
        <div className="microlabel">What we checked it against</div>
        {data.evidence.length === 0 ? (
          <p className="mt-4 text-[15px] text-muted-foreground">
            {data.verdictClass === "not_enough_evidence"
              ? "We could not verify this claim with the evidence available. If you know of an official source, tell us."
              : "No external evidence was needed for this check."}
          </p>
        ) : (
          <>
            {evidence.map((item) => {
              // Stored code → what it means, in words a reader already uses.
              // A row the check could not classify renders "Not classified".
              const source = describeEvidenceSource(item.tier);
              return (
                <Fragment key={item.seriesIdentity}>
                  <Separator className="mt-4" />
                  <div className="grid grid-cols-[150px_1fr] gap-5 py-4">
                    <div className="microlabel pt-0.5">
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all text-primary normal-case hover:underline"
                        >
                          {item.authorityRef}
                        </a>
                      ) : (
                        item.authorityRef
                      )}
                      <Badge
                        variant="secondary"
                        className="mt-1 flex w-fit rounded-md px-1.5 py-0.5 text-[10.5px] leading-[1.35] font-semibold whitespace-normal normal-case"
                      >
                        {source.label}
                      </Badge>
                    </div>
                    <div className="min-w-0">
                      <b className="text-[15.5px] font-bold">{item.seriesIdentity}</b>
                      {item.plainReason ? (
                        <p className="mt-1 text-[13.5px] leading-relaxed whitespace-pre-line text-muted-foreground">
                          {item.plainReason}
                        </p>
                      ) : null}
                      <p className="font-mono text-[12px] text-faint">checked {item.vintageDate}</p>
                    </div>
                  </div>
                </Fragment>
              );
            })}
            <EvidenceSourceKey />
          </>
        )}
      </Card>

      {/* Provenance — collapsed by default, the one place technical vocabulary
          is permitted. forceMount keeps it in the SSR HTML (no-JS + unfurlers)
          while it stays closed until asked for. */}
      <Accordion type="single" collapsible className="mt-4 rounded-xl border bg-card px-7">
        <AccordionItem value="provenance" className="border-b-0">
          <AccordionTrigger className="text-[11px] font-extrabold tracking-[.12em] text-faint uppercase hover:no-underline">
            How this verdict was made
          </AccordionTrigger>
          <AccordionContent forceMount className="text-[12px] text-faint">
            <p>
              Pipeline version {data.pipelineVersion}. Prompt versions:{" "}
              {/* The value already carries its role (`grid-materiality@1`), so
                  rendering the key too produced "adjudication@adjudication@1". */}
              {Object.values(data.promptVersions).join(", ")}
              {Object.keys(data.modelVersions).length > 0
                ? ` · Models: ${Object.entries(data.modelVersions)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(", ")}`
                : ""}
              {data.searchRefs.length > 0
                ? ` · Search queries recorded: ${data.searchRefs.length}`
                : ""}
              {data.transcriptTier ? ` · transcript tier: ${data.transcriptTier}` : ""}
              {sourceCodes ? ` · evidence source codes: ${sourceCodes}` : ""}.
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Metarow + contest (mockup footer material). The contest flow names
          the future contestation slice without building it (SITE-MVP
          out-of-scope note). */}
      <div className="mt-4 flex flex-wrap gap-4 px-2 text-[12.5px] text-muted-foreground">
        <span>
          Checked{" "}
          {data.publishedAt.toLocaleDateString("en-NZ", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
        <span aria-hidden="true">·</span>
        <a className="text-primary hover:underline" href="/methodology">
          How we check claims
        </a>
      </div>
      <p className="mt-3 border-l border-dashed border-border pl-4 text-[12px] text-faint">
        <b>How this verdict was made:</b> produced by our automated pipeline ({data.pipelineVersion}
        ) and quality-audited. Data tables, prompt versions and audit results are logged and public.
      </p>
      <p className="mt-4 text-[15px]">
        <b className="font-extrabold">Think we&apos;ve got this wrong?</b>{" "}
        <a className="font-semibold text-primary hover:underline" href="/methodology">
          Tell us
        </a>{" "}
        — with a source we should have used. Contests are public, and when one checks out we change
        the verdict and show the change history.
      </p>
    </main>
  );
}
