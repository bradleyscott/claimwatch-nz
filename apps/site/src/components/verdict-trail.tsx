import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  TECHNICAL_RECORD_KEY,
  type VerdictTrail as Trail,
  type TrailStep,
} from "@/lib/verdict-page";

// "How this verdict was made" (SITE-MVP §2.3, Sept 2026) — the dated trail that
// replaced the provenance accordion, the "Checked …" metarow and the dashed
// paragraph that restated the accordion's own heading. Built from the vendored
// shadcn primitives so it themes from the ClaimWatch tokens like every other
// card.
//
// Two things to know before editing:
//
// - Every step, its sources and its audit line are always visible. No accordion,
//   no reveal control: a record a reader has to ask for is one most readers
//   never see. Lines are one fact each, and nothing restates the verdict card
//   above or the /methodology page.
// - Each audit line carries `data-provenance-line`. That is not a styling hook:
//   the register scan keys on it to exclude the one region allowed internal
//   vocabulary (SIT-R4, see `publicCopyOf` in the render test). Move the line and
//   the attribute moves with it.
//
// `TECHNICAL_RECORD_KEY` (in lib/verdict-page.ts) defines every label and opaque
// value those lines can contain, and is register-scanned like any other public
// copy.

/** The rail marker: filled on the step that reached the verdict. */
function StepDot({ step }: { step: TrailStep }) {
  return (
    <span
      aria-hidden="true"
      // `block`: a bare span is inline, where width/height are ignored and the
      // marker collapses into a border-only sliver.
      className={`mt-1.5 block size-[11px] flex-none rounded-full border-2 ${
        step.mark === "answer" ? "border-foreground bg-foreground" : "border-faint bg-card"
      }`}
    />
  );
}

function StepRow({ step }: { step: TrailStep }) {
  return (
    <div className="grid grid-cols-[84px_1fr] gap-4 border-border border-t py-3 first:border-t-0 sm:grid-cols-[96px_12px_1fr]">
      <div className="pt-0.5 text-[12px] font-bold text-muted-foreground">
        {step.dayLabel}
        {step.timeLabel ? (
          <span className="block font-mono text-[11px] font-medium text-faint">
            {step.timeLabel}
          </span>
        ) : null}
      </div>
      <div className="hidden sm:block">
        <StepDot step={step} />
      </div>
      <div className="min-w-0">
        <h3 className="text-[14.5px] font-bold tracking-tight">{step.title}</h3>
        {step.facts.map((fact) => (
          <p key={fact} className="mt-0.5 text-[13px] leading-snug">
            {fact}
          </p>
        ))}
        {step.sources.length > 0 ? (
          <div className="mt-2 flex flex-col gap-2">
            {step.sources.map((source) => (
              <Card
                // A series can legitimately appear twice (two vintages), so the
                // key is the row's identity plus the dates that distinguish it.
                key={`${source.title}-${source.dates}`}
                className="gap-0 px-3 py-2.5 shadow-none"
              >
                <b className="text-[13px] font-bold text-foreground">
                  {source.url ? (
                    <a
                      className="text-primary hover:underline"
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {source.title}
                    </a>
                  ) : (
                    source.title
                  )}
                </b>
                {source.finding ? (
                  <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
                    {source.finding}
                  </p>
                ) : null}
                {source.dates ? (
                  <p className="mt-1 font-mono text-[11px] text-faint">{source.dates}</p>
                ) : null}
              </Card>
            ))}
          </div>
        ) : null}
        {step.note ? (
          <p className="mt-1.5 text-[12.5px] leading-snug text-faint">{step.note}</p>
        ) : null}
        <p
          data-provenance-line=""
          className="mt-1.5 font-mono text-[11px] leading-relaxed text-faint"
        >
          {step.technical}
        </p>
      </div>
    </div>
  );
}

export function VerdictTrail({ trail }: { trail: Trail }) {
  return (
    <Card className="trail mt-4 gap-0 px-7 py-6" aria-label="How this verdict was made">
      <CardHeader className="px-0">
        <CardTitle className="text-[17px] font-extrabold tracking-tight">
          How this verdict was made
        </CardTitle>
        <CardAction className="text-[12.5px] font-semibold text-muted-foreground">
          {trail.headline}
        </CardAction>
      </CardHeader>

      <CardContent className="mt-3 px-0">
        <div className="relative">
          {/* The rail: one line behind every step's marker. */}
          <Separator
            orientation="vertical"
            className="absolute top-4 bottom-4 left-[117px] hidden h-auto sm:block"
          />
          {trail.steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </div>

        {/* The key to the lines above. A native <details> for the same reason the
            evidence card's source key is one: the explanation stays in the
            server-rendered HTML for no-JS readers and crawlers, needs no client
            JavaScript, and is reachable by keyboard, touch and screen readers. */}
        <details className="group mt-5 border-border border-t pt-4">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-extrabold tracking-[.12em] text-faint uppercase hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden="true"
              className="inline-block text-[13px] leading-none transition-transform group-open:rotate-90"
            >
              ›
            </span>
            What the technical record means
          </summary>
          <dl className="mt-3 space-y-2 text-[13px] leading-relaxed text-muted-foreground">
            {TECHNICAL_RECORD_KEY.map((entry) => (
              <div key={entry.term} className="grid grid-cols-[150px_1fr] gap-5">
                <dt className="font-mono text-[11.5px] font-semibold text-foreground">
                  {entry.term}
                </dt>
                <dd>{entry.meaning}</dd>
              </div>
            ))}
          </dl>
        </details>
      </CardContent>

      <CardFooter className="mt-3 flex-col items-start gap-2 border-border border-t px-0">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Button variant="link" size="sm" className="px-0" asChild>
            <a href="/methodology">How we check claims</a>
          </Button>
        </div>
        <p className="max-w-[660px] text-[13.5px] leading-relaxed">
          <b className="font-extrabold">Think we&apos;ve got this wrong?</b>{" "}
          <Button variant="link" size="sm" className="h-auto px-0 text-[13.5px]" asChild>
            <a href="/methodology">Tell us</a>
          </Button>{" "}
          with a source we should have used — contests and every change are public.
        </p>
      </CardFooter>
    </Card>
  );
}
