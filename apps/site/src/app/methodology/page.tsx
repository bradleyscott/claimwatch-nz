import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VERDICT_TONES } from "@/components/verdict-rule";
import {
  type AccuracyTableRow,
  loadAccuracyArtifact,
  renderAccuracyTable,
} from "@/lib/accuracy-artifact";
import { cn } from "@/lib/utils";
import { VERDICT_LABELS, type VerdictClass } from "@/lib/verdict-page";

// Methodology page (SITE-MVP §2.5): the one public page whose job is explaining
// the machinery — plain English throughout (register rules §2.2), and the
// measured-accuracy table is GENERATED from the harness artifact (SIT-R2).
// The artifact is a build-time read; a missing artifact fails `next build`.

const VERDICT_MEANINGS: Array<{ cls: VerdictClass; plain: string }> = [
  { cls: "supported", plain: "The official data backs the claim." },
  { cls: "refuted", plain: "The official data contradicts the claim." },
  {
    cls: "conflicting_cherry_picking",
    plain:
      "The number is real, but picking that window or comparison changes the picture. We show the alternatives.",
  },
  {
    cls: "not_enough_evidence",
    plain:
      "We could not verify it either way — the claim stays an open question rather than getting a confident answer.",
  },
];

function loadTable(): { rows: AccuracyTableRow[]; runId: string } | null {
  try {
    const repoRoot = process.env.SITE_REPO_ROOT ?? "../../..";
    const artifact = loadAccuracyArtifact(repoRoot);
    return { runId: artifact.runId, rows: renderAccuracyTable(artifact) };
  } catch {
    // SIT-R2: CI fails the build on the equality test, so a deployed page
    // always rendered from a real artifact; locally we hide nothing — the
    // error is shown in the table slot.
    return null;
  }
}

function Section({
  title,
  children,
  label,
}: {
  title: string;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <Card className="mt-4 gap-0 px-7 py-6" aria-label={label}>
      <h2 className="text-[17px] font-extrabold">{title}</h2>
      {children}
    </Card>
  );
}

export default function MethodologyPage() {
  const table = loadTable();

  return (
    <main className="page-shell py-6">
      <h1 className="mt-4 text-[24px] font-extrabold tracking-tight">How this works</h1>

      <Section label="What ClaimWatch is" title="What ClaimWatch is and isn't">
        <p className="mt-3 text-[15.5px] leading-relaxed">
          We check claims made in New Zealand politics against the official data — police figures,
          Statistics NZ series, Treasury forecasts, and the source a claim cites. Every claim gets
          one of four verdicts. There are no degrees in between: a claim either holds up, does not,
          cannot be checked, or is real but framed in a way that changes the picture.
        </p>
      </Section>

      <Section label="The four verdicts" title="The four verdicts">
        <ul className="mt-3 space-y-3">
          {VERDICT_MEANINGS.map((v) => (
            <li
              key={v.cls}
              className="flex flex-wrap items-baseline gap-2 text-[15px] leading-relaxed"
            >
              <Badge
                variant="secondary"
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
                  VERDICT_TONES[v.cls].chip,
                )}
              >
                {VERDICT_LABELS[v.cls].label}
              </Badge>
              <span>{v.plain}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section label="How we check" title="How we check claims">
        <p className="mt-3 text-[15.5px] leading-relaxed">
          A claim with a number gets checked against the full official record — we show what the
          same data looks like over different windows and per person, so a true number with a
          misleading frame is visible. A claim citing a source gets checked against that source.
          Broadcast claims are checked against the exact words recorded. Everything else goes to the
          open web, which is our least reliable method — those verdicts are the ones most worth
          contesting.
        </p>
      </Section>

      <Section label="Measured accuracy" title="How accurate is this? Measured, not claimed">
        {table === null ? (
          <Alert className="mt-3 border-verdict-incomplete-line bg-verdict-incomplete-soft text-verdict-incomplete-ink">
            <AlertDescription className="text-[13.5px] text-verdict-incomplete-ink">
              The accuracy table will appear here after the first published scoring run. We will not
              display a number until it comes from a recorded, reproducible run — and the run id
              will sit next to it.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11.5px] font-extrabold tracking-[.05em] text-faint uppercase">
                    What was checked
                  </TableHead>
                  <TableHead className="text-[11.5px] font-extrabold tracking-[.05em] text-faint uppercase">
                    Agreement with our labellers
                  </TableHead>
                  <TableHead className="text-[11.5px] font-extrabold tracking-[.05em] text-faint uppercase">
                    Claims checked
                  </TableHead>
                  <TableHead className="text-[11.5px] font-extrabold tracking-[.05em] text-faint uppercase">
                    Cost per claim
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.rows.map((row) => (
                  <TableRow key={row.mode}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell className="font-bold">{row.accuracyPercent}%</TableCell>
                    <TableCell>{row.n}</TableCell>
                    <TableCell>${row.costPerClaim.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-3 text-[12px] text-faint">
              Generated from scoring run <b>{table.runId}</b> — the number above is produced by the
              harness, never edited by hand.
            </p>
          </>
        )}
      </Section>

      <Section label="Known gaps" title="What we can't check yet">
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed">
          <li>
            Audio-only sources: we read words that were published, not transcripts we generate.
          </li>
          <li>
            Claims from automatically generated captions are flagged on their verdict pages — the
            wording can contain transcription errors.
          </li>
          <li>
            Claims made in te reo Māori: a known gap we intend to close with iwi and kaupapa
            partners.
          </li>
          <li>
            You can contest any verdict — when a contest checks out, the verdict changes and the
            change history is public.
          </li>
        </ul>
      </Section>

      <Section label="What we choose to check" title="We don't check everything we can">
        <p className="mt-3 text-[15px] leading-relaxed">
          A statement can be checkable and still not be worth a verdict — a figure mentioned in
          passing, with no policy topic and no argument around it. We set those aside, and we record
          the reason. The test is fixed and published in advance:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed">
          <li>It was used in support of a proposal, or</li>
          <li>it takes a side in an argument, or</li>
          <li>it is about a policy topic.</li>
        </ul>
        <p className="mt-3 text-[15px] leading-relaxed">
          If none of those is true, the statement is recorded but not checked. This is a choice
          about what is worth your attention, never a claim that something is false or unimportant —
          and it cannot see who said it, because the rule reads the argument and not the person.
          When we cannot read the passage a statement came from, it is kept rather than set aside,
          so a gap in our reading never becomes a reason to skip something.
        </p>
      </Section>
    </main>
  );
}
