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
import type { VerdictTrail as Trail, TrailStep } from "@/lib/verdict-page";

// "How this verdict was made" (SITE-MVP §2.3, Sept 2026) — the dated trail that
// replaced the provenance accordion, the "Checked …" metarow and the dashed
// paragraph that restated the accordion's own heading. Built from the vendored
// shadcn primitives so it themes from the ClaimWatch tokens like every other
// card.
//
// Every step is always visible, technical record included. Two consequences
// worth knowing before editing:
//
// - No accordion and no toggle. The first version of this block put the steps in
//   collapsed drawers with the machine record behind a checkbox; a record a
//   reader has to ask for is one most readers never see, so the steps are now a
//   plain dated list and the audit line is part of each row.
// - Each technical line carries `data-provenance-line`. It is not a styling hook
//   — the register scan keys on it to exclude the one region allowed internal
//   vocabulary (SIT-R4, see `publicCopyOf` in the render test). Moving it breaks
//   the scan silently, so it moves with the attribute.

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
          <ul className="mt-1.5 flex flex-col gap-1">
            {step.sources.map((source) => (
              <li
                // A series can legitimately appear twice (two vintages), so the
                // key is the row's identity plus the dates that distinguish it.
                key={`${source.title}-${source.dates}`}
                className="text-[12.5px] leading-snug text-muted-foreground"
              >
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
                {source.dates ? <span className="text-faint"> · {source.dates}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {step.note ? (
          <p className="mt-1 text-[12.5px] leading-snug text-faint">{step.note}</p>
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
