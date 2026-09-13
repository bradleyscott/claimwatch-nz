import { EVIDENCE_SOURCE_KEY_LEVELS } from "@/lib/evidence-source-labels";

// "What these labels mean" — the verdict page's inline definition of the source
// wording (SITE-MVP §2.3). A native <details> rather than a hover tooltip or a
// Radix popover on purpose: the explanation is in the server-rendered HTML
// (SIT-R8 — no-JS readers and crawlers get it), it needs no client JavaScript,
// and it is reachable by keyboard, touch and screen readers alike. A `title`
// attribute — what the page used before — is none of those things.
export function EvidenceSourceKey() {
  return (
    <details className="group mt-5 border-t pt-4">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-extrabold tracking-[.12em] text-faint uppercase [&::-webkit-details-marker]:hidden hover:text-foreground">
        <span
          aria-hidden="true"
          className="inline-block text-[13px] leading-none transition-transform group-open:rotate-90"
        >
          ›
        </span>
        What these labels mean
      </summary>
      <dl className="mt-3 space-y-2 text-[13px] leading-relaxed text-muted-foreground">
        {EVIDENCE_SOURCE_KEY_LEVELS.map((level) => (
          <div key={level.code} className="grid grid-cols-[150px_1fr] gap-5">
            <dt className="font-semibold text-foreground">{level.label}</dt>
            <dd>{level.description}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[12px] text-faint">
        Listed strongest source first — anything our check could not place comes last. Every claim
        is checked against the best source that exists for it; where only weaker sources exist, the
        verdict says so — and where the claim cites a source, we check that source too.
      </p>
    </details>
  );
}
