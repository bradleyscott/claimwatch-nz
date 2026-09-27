import { claimReviewFromVerdict } from "@cw/store";
import { Fragment, type ReactNode } from "react";
import { EvidenceSourceKey } from "@/components/evidence-source-key";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { VERDICT_TONES, VerdictRule } from "@/components/verdict-rule";
import { VerdictTrail } from "@/components/verdict-trail";
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

export default async function ClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { getSiteStore, installLiveStore, readOptionsFromSearch } = await import(
    "@/lib/site-store"
  );
  if (process.env.SITE_STORE === "live" && process.env.DATABASE_URL) {
    // Schema is guaranteed current by the startup migration step
    // (drizzle-kit migrate in the service entrypoint) — the page just reads.
    installLiveStore(process.env.DATABASE_URL);
  }
  // Public record by default; `?corpus=all` serves a record with no ingested
  // document behind it (the AVeriTeC evaluation corpus).
  const data = await getSiteStore().getVerdictPage(id, readOptionsFromSearch(await searchParams));
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

  // Strongest source first (SITE-MVP §2.3): the reader should meet the series
  // that settles the claim before the commentary about it. Sorting is by stored
  // source code; rows the check could not classify sink to the bottom.
  const evidence = orderEvidenceBySourceQuality(data.evidence);

  // Raw source codes for the trail's technical record only — the evidence list
  // renders their plain-language descriptions (SITE-MVP §2.2 rule 4, SIT-R4).
  const sourceCodes = evidenceSourceCodes(evidence);

  const model = buildVerdictPageModel({
    claimId: data.claimId,
    claimText: data.claimText,
    speaker: data.speaker,
    speakerVenue: data.speakerVenue,
    speakerAffiliation: data.speakerAffiliation,
    publishedAt: data.publishedAt,
    verdictClass: data.verdictClass,
    confidence: data.confidence,
    attachedProposal: data.attachedProposal,
    mediaAnchor: data.mediaAnchor,
    transcriptTier: data.transcriptTier,
    evidence,
    pipelineVersion: data.pipelineVersion,
    promptVersions: data.promptVersions,
    modelVersions: data.modelVersions,
    searchRefs: data.searchRefs,
    sourceCodes,
    claimMadeAt: data.claimMadeAt,
    claimRecordedAt: data.claimRecordedAt,
    sourceRetrievedAt: data.sourceRetrievedAt,
    claimType: data.claimType,
    // Both nullable, and passed through as null rather than omitted (Sept 2026):
    // the trail needs to tell "we hold no mode for this claim" from "this claim is
    // old", and every verdict written before the columns existed is the former.
    verificationMode: data.verificationMode,
    triageRecord: data.triageRecord,
    publisher: data.publisher,
    sourceUrl: data.sourceUrl,
    claimPromptVersions: data.claimPromptVersions,
    claimModelVersion: data.claimModelVersion,
    checkedAt: data.checkedAt,
    nliOutcome: data.nliOutcome,
    verdictVersion: data.verdictVersion,
    verdictStatus: data.verdictStatus,
  });

  const tone = VERDICT_TONES[data.verdictClass];

  // The claim's own date when the store holds one. `publishedAt` is when the
  // VERDICT was published — used as the claim's date it made the page say a
  // claim was made the day we checked it (SITE-MVP §2.3). ClaimReview requires a
  // date on the reviewed item, so the payload keeps the fallback while the page
  // renders nothing when the claim date is genuinely unknown.
  const claimDate = data.claimMadeAt ?? data.publishedAt;

  // The discovery channel (SIT-R1): one ClaimReview per verdict page, rendered
  // server-side in the initial HTML — Google Fact Check Explorer reads this.
  const claimReview = claimReviewFromVerdict({
    verdictUrl: `https://claimwatch.nz/claim/${data.claimId}`,
    claimText: data.claimText,
    verdictClass: data.verdictClass,
    publishedAt: data.publishedAt.toISOString(),
    claimPublishedAt: claimDate.toISOString(),
    claimantName: data.speaker ?? "Unknown",
    claimantKind: data.speaker ? "person" : "unknown",
    ...(data.mediaAnchor ? { mediaAnchor: data.mediaAnchor } : {}),
  });

  const justifications = data.justifications.filter((j) => !j.startsWith("Deep research checked"));

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
        {/* One line: who said it, where it was said, the original item it came
            from, and when. The source link sits inline so a reader can read the
            claim in place — it is a sentence pulled out of a document.

            The date is the claim's own, rendered only when the store holds one:
            `claimDate` falls back to the verdict's publication date for the
            ClaimReview payload (which requires a date), but showing that fallback
            here would state the day we checked the claim as the day it was made. */}
        {(() => {
          const parts: Array<{ key: string; node: ReactNode }> = [];
          if (data.speaker) {
            parts.push({
              key: "who",
              node: (
                <b className="font-semibold text-foreground">
                  {data.speaker}
                  {data.speakerAffiliation ? `, ${data.speakerAffiliation}` : ""}
                </b>
              ),
            });
          } else if (data.speakerAffiliation) {
            parts.push({ key: "affiliation", node: <span>{data.speakerAffiliation}</span> });
          }
          if (data.speakerVenue) {
            parts.push({ key: "venue", node: <span>{data.speakerVenue}</span> });
          }
          if (data.sourceUrl) {
            parts.push({
              key: "source",
              node: (
                <span>
                  As reported in{" "}
                  <a
                    href={data.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Read the original article"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {data.publisher ?? sourceHost(data.sourceUrl)}
                  </a>
                </span>
              ),
            });
          }
          if (data.claimMadeAt) {
            parts.push({
              key: "date",
              node: (
                <span>
                  {data.claimMadeAt.toLocaleDateString("en-NZ", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    timeZone: "Pacific/Auckland",
                  })}
                </span>
              ),
            });
          }
          if (parts.length === 0) return null;
          return (
            <div className="mt-4 text-[13.5px] text-muted-foreground">
              {parts.map((part, index) => (
                <Fragment key={part.key}>
                  {index > 0 ? <span className="mx-1.5 text-border">·</span> : null}
                  {part.node}
                </Fragment>
              ))}
            </div>
          );
        })()}
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

      {/* How this verdict was made — the dated trail (SITE-MVP §2.3). It
          replaced three things that said the same thing: a collapsed provenance
          accordion, the "Checked … · How we check claims" metarow, and a dashed
          paragraph that restated the accordion's own heading and body. The
          technical record is the one place internal vocabulary is permitted
          (§2.2 rule 4) and sits behind this block's single control. */}
      <VerdictTrail trail={model.trail} />
    </main>
  );
}

/** A publication's display name when the store holds no publisher: its host. */
function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
