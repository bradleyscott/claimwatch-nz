import {
  type AccuracyTableRow,
  loadAccuracyArtifact,
  renderAccuracyTable,
} from "@/lib/accuracy-artifact";
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

export default function MethodologyPage() {
  const table = loadTable();

  return (
    <main className="mx-auto max-w-[820px] px-5 py-6">
      <h1 className="mt-4 text-[24px] font-extrabold tracking-tight">How this works</h1>

      <section
        className="mt-4 rounded-2xl border border-line bg-card px-7 py-6"
        aria-label="What ClaimWatch is"
      >
        <h2 className="text-[17px] font-extrabold">What ClaimWatch is and isn't</h2>
        <p className="mt-3 text-[15.5px] leading-relaxed text-[#2c3644]">
          We check claims made in New Zealand politics against the official data — police figures,
          Statistics NZ series, Treasury forecasts, and the source a claim cites. Every claim gets
          one of four verdicts. There are no degrees in between: a claim either holds up, does not,
          cannot be checked, or is real but framed in a way that changes the picture.
        </p>
      </section>

      <section
        className="mt-4 rounded-2xl border border-line bg-card px-7 py-6"
        aria-label="The four verdicts"
      >
        <h2 className="text-[17px] font-extrabold">The four verdicts</h2>
        <ul className="mt-3 space-y-3">
          {VERDICT_MEANINGS.map((v) => (
            <li key={v.cls} className="text-[15px] leading-relaxed">
              <b className="font-bold">{VERDICT_LABELS[v.cls].label}</b> — {v.plain}
            </li>
          ))}
        </ul>
      </section>

      <section
        className="mt-4 rounded-2xl border border-line bg-card px-7 py-6"
        aria-label="How we check"
      >
        <h2 className="text-[17px] font-extrabold">How we check claims</h2>
        <p className="mt-3 text-[15.5px] leading-relaxed text-[#2c3644]">
          A claim with a number gets checked against the full official record — we show what the
          same data looks like over different windows and per person, so a true number with a
          misleading frame is visible. A claim citing a source gets checked against that source.
          Broadcast claims are checked against the exact words recorded. Everything else goes to the
          open web, which is our least reliable method — those verdicts are the ones most worth
          contesting.
        </p>
      </section>

      <section
        className="mt-4 rounded-2xl border border-line bg-card px-7 py-6"
        aria-label="Measured accuracy"
      >
        <h2 className="text-[17px] font-extrabold">How accurate is this? Measured, not claimed</h2>
        {table === null ? (
          <p className="mt-3 rounded-xl border border-[#eddfc2] bg-[#fdf8ef] p-4 text-[13.5px] text-[#8a5a12]">
            The accuracy table will appear here after the first published scoring run. We will not
            display a number until it comes from a recorded, reproducible run — and the run id will
            sit next to it.
          </p>
        ) : (
          <>
            <table className="mt-4 w-full border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] font-extrabold uppercase tracking-[.05em] text-faint">
                  <th className="py-2 pr-3">What was checked</th>
                  <th className="py-2 pr-3">Agreement with our labellers</th>
                  <th className="py-2 pr-2">Claims checked</th>
                  <th className="py-2">Cost per claim</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r) => (
                  <tr key={r.mode} className="border-b border-line last:border-0">
                    <td className="py-2.5 pr-3">{r.label}</td>
                    <td className="py-2.5 pr-3 font-bold">{r.accuracyPercent}%</td>
                    <td className="py-2.5 pr-2">{r.n}</td>
                    <td className="py-2.5">${r.costPerClaim.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[12px] text-[#8a919b]">
              Generated from scoring run <b>{table.runId}</b> — the number above is produced by the
              harness, never edited by hand.
            </p>
          </>
        )}
      </section>

      <section
        className="mt-4 rounded-2xl border border-line bg-card px-7 py-6"
        aria-label="Known gaps"
      >
        <h2 className="text-[17px] font-extrabold">What we can't check yet</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-[#2c3644]">
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
      </section>
    </main>
  );
}
