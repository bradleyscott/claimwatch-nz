# User submission of claims, articles, and sources — what the famous sites do, and our mechanism

*Companion note to WEBSITE-UX-RESEARCH.md and DISCOVERY-MECHANISM.md. Covers the intake side: how users get content *into* the system.*

## What the famous sites do

**PolitiFact** — the lightest mechanism: an email inbox (`truthometer@politifact.com`). Readers send suggestions; "we often fact-check statements submitted by readers"; editorial selection picks the most newsworthy. No form, no status tracking, no promise of coverage. Corrections go to the same inbox.

**Full Fact** — the most developed intake for an election context: a **WhatsApp tipline** (photo a leaflet, flyer, or local ad and send it in — "particularly interested in claims which may not otherwise be visible online"), running through election windows. Explicit framing: "We can't fact check everything that is sent in, but everything you do send in helps us to build a picture of the campaign" — submissions are treated as *signal about what's circulating*, not as a queue promising individual service.

**FactCheck.org** — "Ask FactCheck" reader questions answered as published articles; correction requests via email.

**Common pattern across all of them:** intake is *easy to use, deliberately unpromise-keeping* — no status tracking, no commitment to check what's submitted, human triage against editorial priorities. The submission channel is a *radar*, not a service-level agreement.

## Our structural difference

Every site above is bottlenecked by human capacity (~2–10 published checks/day). Their submissions compete with each other for scarce human attention, so intake is guarded by triage.

**Our pipeline is automated and ingests continuously.** A submitted claim doesn't compete for human attention — it enters the same queue as pipeline-detected claims, gets triaged by the same check-worthiness scoring, and gets a verdict on the same timeline as everything else. That changes the *contract* we can honestly offer: not "we'll consider your suggestion" but "your claim enters the public queue and you can watch its status."

This also aligns with the never-trust-submissions rule (ADR-0002/0006): a user-submitted quote is **never evidence of what was said**. Submissions are *pointers* to content; the claim only enters the store when the pipeline ingests the underlying publication itself (the URL the user pointed at), extracts the claim from the actual text, and anchors it.

## The proposed mechanism

### One intake surface, two object types

A **"Submit" action** in the site header (no login required at launch) with two paths:

**1. Submit a source (article, publication, URL)**
- Input: a URL (or pasted text + origin description for offline material — a leaflet, letterbox flyer, local-paper ad, printed policy document, exactly Full Fact's "not visible online" case)
- What happens: the source enters the ingestion queue as a *proposed publication*. If it's from an already-ingested lane (Beehive, RNZ, a tracked broadcaster's YouTube, etc.), it merges with the pipeline's own copy. If it's from a new source, the ADR-0009 source-proposal process flags it for the maintainer decision record (source-register mechanics, party-blind criteria)
- The publication page is created immediately in "proposed" state, so the user can watch it move: proposed → ingested → claims extracted → verdicts published

**2. Submit a claim (a quote or paraphrase)**
- Input: the claim text, plus *any* locating context the user has (who said it, where, roughly when, a link if they have one) — all optional except the text
- What happens: the submission is **fuzzy-matched against the claim store** first (trigram + semantic, the same index as site search). Two outcomes:
  - **Match found** → the user is shown the existing claim card with its verdict ("already checked — here's the verdict and evidence"). This is the *majority* case in practice and the cheapest service we can render: most submitted claims will already be in the corpus.
  - **No match** → the submission becomes a **verification request** on the public record: text, submitter-supplied context, timestamp, and a status visible to anyone (`requested` → `located` when the pipeline finds the underlying publication → `checked` when verdicts publish, or `unverifiable` if the source can't be located)

### The locating step is the design's crux

A user-submitted claim without a verifiable source is exactly the trap ADR-0014 ruled out for transcription: an unanchored claim can't be checked fairly, and anchoring a claim to something the submitter *says* someone said is the worst failure mode (attribution of an unmade claim). So:

- The pipeline's retrieval loop attempts to **locate the claim in our ingested sources** (full-text + semantic search over publications and transcripts) — most campaign claims surface in multiple ingested outlets within days, so this succeeds often
- If located, the claim is extracted and anchored to the *actual publication* (with media anchor where applicable) and verified normally — the user's submission becomes a fulfilled request
- If not located within a defined window (say, 14 days), the request is marked **`unverifiable — source not found`**, publicly displayed with that status and the reason. We do not check unverifiable claims, and the public record of *why* is itself transparency
- Submissions that locate to **out-of-scope sources** (self-generated transcription would be required — ZB audio-only segments, captionless podcasts — or Māori-language content) are closed as `out of scope` with a link to the scope ADRs

### What submitters get back

- **A permanent URL for their submission** — the request page shows status, matching claims found, and (on success) the verdict card(s)
- **No identity required** — name/email optional; anonymous submissions are fine (the anti-abuse posture below handles the risk)
- **Email notification on status change, optional** — requires an email address, so default is off

### Volume safety and abuse

- **Rate limits and dedup**: identical/paraphrase submissions collapse into one request with a counter (N people asked about this claim — a genuinely useful demand signal, displayed on the claim card: "18 verification requests")
- The demand counter feeds **prioritisation**: pipeline triage weights check-worthiness *plus* public request volume (this is the legitimate, party-blind way reader interest enters the queue — the same signal PolitiFact's editors apply manually)
- Honeypot + rate limiting per IP for spam; heavy abuse patterns deferred to post-launch

### Never-trust boundary (restated in the interface)

The submission form says plainly: *"We don't take anyone's word for what was said — including yours. We check claims against the original published source. Your submission tells us where to look."* This keeps the interface honest about the system's epistemics, and it's also a *teaching moment* about how verification works.

### The contestation channel is separate

Submitting a claim is not contesting a verdict. Contestation (disagreeing with a *published* verdict, with evidence) runs through the ADR-0002 mechanism and mutates verdicts when validated. The submit form and the contest form are distinct surfaces with distinct purposes, cross-linked from each other so users land in the right place.

## What we don't build at launch

- **No WhatsApp tipline** — Full Fact's channel makes sense where claims circulate offline (leaflets, posters) and can't be auto-ingested; our lane structure covers NZ's online campaign surface, and a messaging tipline adds moderation load and PII handling. Revisit if evidence shows a leaflet/poster problem in 2026.
- **No accounts** — submissions are URL-scoped, not identity-scoped; rate limiting is per-IP.
- **No voting on which claims to check** — the request counter is the demand signal; a Digg-style voting surface would gamify selection and invite brigading.

## Summary

**One "Submit" button, two paths:** a source URL enters the ingestion queue as a proposed publication; a pasted claim first fuzzy-matches the existing corpus (most requests are answered instantly with an existing verdict), and otherwise becomes a public verification request whose status the submitter can follow: `requested → located → checked`, or honestly closed as `unverifiable` / `out of scope`. Submissions are pointers, never evidence; the never-trust rule is stated in the interface itself. The deduplicated request counter becomes a party-blind prioritisation signal — the automated analogue of the editorial triage the famous sites perform by hand.