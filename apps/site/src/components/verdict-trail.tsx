import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  TECHNICAL_RECORD_KEY,
  type VerdictTrail as Trail,
  type TrailSection,
} from "@/lib/verdict-page";

// "How this verdict was made" (SITE-MVP §2.3, Sept 2026) — the mode-aware
// account of the check: what the claim was read as, which check that produced,
// how that kind of check works and what it did here, what it was compared
// against, and the second pass on our own reasoning.
//
// Three things to know before editing:
//
// - Five sections, and the middle one is the only part that varies with the
//   check. Sections can render as an ABSENCE (a claim whose document record or
//   whose mode we do not hold): that is a designed state, not a failure. An
//   absent section states what is missing; it is never filled with a generic
//   paragraph, because an empty or paraphrased section is indistinguishable
//   from a check that ran and found nothing to say.
// - Every section and its audit line are always visible. No accordion, no
//   reveal control: a record a reader has to ask for is one most readers never
//   see. Copy is one fact per line, and nothing restates the verdict card above
//   or the /methodology page.
// - Each audit line carries `data-provenance-line`. That is not a styling hook:
//   the register scan keys on it to exclude the one region allowed internal
//   vocabulary (SIT-R4, see `publicCopyOf` in the render test). Move the line
//   and the attribute moves with it.
//
// `TECHNICAL_RECORD_KEY` (in lib/verdict-page.ts) defines the opaque values
// those lines can print — the lines label their own parts in plain words — and
// is register-scanned like any other public copy.

/** One section: its heading, its prose, and whatever else it carries. */
function TrailSectionRow({ section }: { section: TrailSection }) {
  return (
    <section
      className="grid grid-cols-[84px_1fr] gap-4 border-border border-t py-4 first:border-t-0 sm:grid-cols-[96px_1fr]"
      data-trail-section={section.kind}
      {...(section.absent ? { "data-trail-absent": "" } : {})}
    >
      <div className="pt-0.5 text-[12px] font-bold text-muted-foreground">{section.when}</div>
      <div className="min-w-0">
        <h3 className="text-[14.5px] font-bold tracking-tight">
          <span className="mr-1.5 font-mono text-[12px] font-semibold text-faint">
            {section.number}
          </span>
          {section.title}
        </h3>

        {section.facts.map((fact) => (
          <p key={fact} className="mt-1 text-[13px] leading-snug">
            {fact}
          </p>
        ))}

        {section.rows.length > 0 ? (
          <table className="mt-2 w-full border-collapse text-[12.5px]">
            <tbody>
              {section.rows.map((row) => (
                <tr
                  key={`${row.label}-${row.value}`}
                  className={`border-border border-t${row.material ? " bg-verdict-incomplete-soft" : ""}`}
                >
                  <td className="py-1.5 pr-3 align-top font-semibold text-foreground">
                    {row.label}
                  </td>
                  <td className="py-1.5 align-top font-mono text-[12px] text-muted-foreground">
                    {row.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {section.decision ? (
          <div className="mt-2 rounded-lg border border-verdict-incomplete-line bg-verdict-incomplete-soft px-3 py-2">
            <div className="microlabel mb-0 text-verdict-incomplete-ink">What this means</div>
            <p className="mt-1 text-[13px] leading-snug font-semibold">{section.decision}</p>
          </div>
        ) : null}

        {section.bounds.length > 0 ? (
          <div className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <div className="microlabel mb-0">
              {section.bounds.length === 1
                ? "What this check cannot establish"
                : "What these checks cannot establish"}
            </div>
            {section.bounds.map((bound) =>
              section.bounds.length === 1 ? (
                <p key={bound.label} className="mt-1 text-[13px] leading-snug text-muted-foreground">
                  {bound.text}
                </p>
              ) : (
                <p key={bound.label} className="mt-1 text-[13px] leading-snug text-muted-foreground">
                  <span className="font-semibold">{bound.label}:</span> {bound.text}
                </p>
              ),
            )}
          </div>
        ) : null}

        {section.asides.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1.5">
            {section.asides.map((aside) => (
              <li key={aside.sentenceText} className="text-[12.5px] leading-snug">
                <span className="text-foreground italic">“{aside.sentenceText}”</span>{" "}
                <span className="text-muted-foreground">
                  {aside.held ? "held back — " : ""}
                  {aside.why}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {section.sources.length > 0 ? (
          <div className="mt-2 flex flex-col gap-2">
            {section.sources.map((source) => (
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

        <p
          data-provenance-line=""
          className="mt-1.5 font-mono text-[11px] leading-relaxed text-faint"
        >
          {section.technical}
        </p>
      </div>
    </section>
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
        {trail.sections.map((section) => (
          <TrailSectionRow key={section.number} section={section} />
        ))}

        {/* The key to the values above. A native <details> for the same reason the
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
            What these values mean
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
