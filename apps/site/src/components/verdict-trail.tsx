import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { VerdictTrail as Trail, TrailStep } from "@/lib/verdict-page";

// "How this verdict was made" (SITE-MVP §2.3, Sept 2026) — the dated trail that
// replaced the provenance accordion, the "Checked …" metarow and the dashed
// paragraph that restated the accordion's own heading. Built from the vendored
// shadcn primitives so it themes from the ClaimWatch tokens like every other
// card, rather than from bespoke styling.
//
// Two deliberate departures from the primitives, both for the transparency
// feature itself:
//
// 1. `forceMount` on every drawer's content. Radix unmounts closed content by
//    default, which would put the whole audit record outside the initial HTML —
//    the opposite of the point. forceMount keeps every word in the server
//    response for no-JS readers, unfurlers and anyone reading the page source.
// 2. A native checkbox (`Input type="checkbox"`) for the technical record
//    rather than a Radix Checkbox: one CSS rule in globals.css keyed on this
//    input's `:checked` state (`[data-provenance-line]`) needs no JavaScript, so
//    the audit lines are readable with scripts disabled.
//
// Register: titles, hints, bodies and "why it matters" lines are public copy and
// are register-checked in `buildVerdictTrail` (SIT-R4). Only `step.technical`
// carries internal vocabulary, and only behind the control (§2.2 rule 4).

/**
 * The rail marker for one step: filled on the step that reached the verdict,
 * hollow before it. Deliberately not coloured by verdict class — the rail is a
 * timeline, and the verdict's own colour already belongs to the verdict card
 * above (SIT-R9: never colour alone).
 */
function StepDot({ step }: { step: TrailStep }) {
  const isAnswer = step.mark === "answer";
  return (
    <span
      aria-hidden="true"
      // `block`: a bare span is inline, where width/height are ignored and the
      // marker collapses into a border-only sliver (which is exactly how it
      // rendered until this was caught on a real page).
      className={`mt-1.5 block size-[11px] flex-none rounded-full border-2 ${
        isAnswer ? "border-foreground bg-foreground" : "border-faint bg-card"
      }`}
    />
  );
}

function StepBody({ step }: { step: TrailStep }) {
  return (
    <div data-trail-body="" className="flex flex-col gap-3 pl-6 sm:pl-[140px]">
      {step.body.map((part) => (
        <div key={`${step.id}-${part.heading}-${part.text}`}>
          {part.heading ? (
            <b className="block text-[13px] font-bold text-foreground">{part.heading}</b>
          ) : null}
          <p className="text-[13px] leading-relaxed">{part.text}</p>
        </div>
      ))}

      {step.sources.map((source) => (
        <Card key={source.title} className="gap-0 px-3 py-2.5 shadow-none">
          <b className="text-[13.5px] font-bold text-foreground">
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
          {source.finding ? <p className="mt-0.5 text-[12.5px]">{source.finding}</p> : null}
          {source.dates ? (
            <p className="mt-1 font-mono text-[11px] text-faint">{source.dates}</p>
          ) : null}
        </Card>
      ))}

      <Alert className="border-border bg-card">
        <AlertTitle className="text-[12.5px]">Why it matters</AlertTitle>
        <AlertDescription className="text-[12.5px] leading-relaxed">{step.why}</AlertDescription>
      </Alert>

      {/* The one place technical vocabulary appears (§2.2 rule 4). Present in the
          HTML always; shown by the control above, with no JavaScript involved. */}
      <p
        data-provenance-line=""
        className="rounded-lg border bg-muted px-3 py-2 font-mono text-[11px] leading-relaxed text-faint"
      >
        {step.technical}
      </p>
    </div>
  );
}

export function VerdictTrail({ trail }: { trail: Trail }) {
  return (
    <Card className="trail mt-4 gap-0 px-7 py-6" aria-label="How this verdict was made">
      {/* With JavaScript disabled neither control works: the drawers cannot be
          opened and the technical record cannot be revealed. Both are therefore
          shown by CSS instead — Radix keeps every drawer's content mounted
          (below), so a reader without scripts gets the whole record rather than
          four headings and a dead checkbox. */}
      <noscript>
        {/* A plain string child: React renders text in <style>, so this needs no
            `dangerouslySetInnerHTML` and no suppression. */}
        <style>
          {"[data-slot='accordion-item'][data-state='closed'] [data-trail-body]{display:block}" +
            "[data-provenance-line]{display:block}"}
        </style>
      </noscript>
      <CardHeader className="px-0">
        <CardTitle className="text-[17px] font-extrabold tracking-tight">
          How this verdict was made
        </CardTitle>
        <CardDescription className="max-w-[620px] text-[13px] leading-relaxed">
          {trail.intro}
        </CardDescription>
        <CardAction className="text-[12.5px] font-semibold text-muted-foreground">
          {trail.headline}
        </CardAction>
      </CardHeader>

      <CardContent className="mt-4 px-0">
        <label
          className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-1.5 text-[12px] text-muted-foreground has-checked:border-solid has-checked:border-border"
          htmlFor="trail-tech-record"
        >
          <Input
            id="trail-tech-record"
            type="checkbox"
            className="size-4 accent-primary shadow-none"
          />
          Show the technical record
          <span className="hidden text-faint sm:inline">— model, prompt and pipeline versions</span>
        </label>

        <div className="relative mt-2">
          {/* The rail: one line behind every step's marker. */}
          <Separator
            orientation="vertical"
            className="absolute top-5 bottom-7 left-[117px] hidden h-auto sm:block"
          />
          <Accordion type="multiple" className="contents">
            {trail.steps.map((step) => (
              <AccordionItem key={step.id} value={step.id} className="border-border">
                <AccordionTrigger className="items-start gap-4 py-3 hover:no-underline">
                  <span className="flex min-w-0 flex-1 items-start gap-4">
                    <span className="w-[84px] flex-none pt-0.5 text-[12px] font-bold text-muted-foreground sm:w-24">
                      {step.dayLabel}
                      {step.timeLabel ? (
                        <span className="block font-mono text-[11px] font-medium text-faint">
                          {step.timeLabel}
                        </span>
                      ) : null}
                    </span>
                    <span className="hidden w-3 flex-none sm:block">
                      <StepDot step={step} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-bold tracking-tight">
                        {step.title}
                      </span>
                      {step.hint ? (
                        <span className="mt-0.5 block text-[12.5px] font-normal text-faint">
                          {step.hint}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent
                  forceMount
                  // forceMount keeps every word in the server HTML; Radix then
                  // leaves visibility to the consumer, which globals.css does
                  // from the item's own `data-state` (the vendored primitive
                  // takes `className` for the inner wrapper, not the stateful
                  // element, so the rule is not written here).
                  className="text-muted-foreground"
                >
                  <StepBody step={step} />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </CardContent>

      <CardFooter className="mt-4 flex-col items-start gap-3 border-t border-border px-0">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Button variant="link" size="sm" className="px-0" asChild>
            <a href="/methodology">How we check claims</a>
          </Button>
          <Button variant="link" size="sm" className="px-0" asChild>
            <a href="/methodology">What we can&apos;t check yet</a>
          </Button>
        </div>
        <p className="max-w-[680px] text-[14.5px] leading-relaxed">
          <b className="font-extrabold">Think we&apos;ve got this wrong?</b>{" "}
          <Button variant="link" size="sm" className="h-auto px-0 text-[14.5px]" asChild>
            <a href="/methodology">Tell us</a>
          </Button>{" "}
          — with a source we should have used. Contests are public, and when one checks out we
          change the verdict and show the change history.
        </p>
      </CardFooter>
    </Card>
  );
}
