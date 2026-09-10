# User submission of claims, articles, and sources

*Companion to `WEBSITE-UX-RESEARCH.md` and `DISCOVERY-MECHANISM.md`. The intake side: how users get content *into* the system.*

## What the famous sites do

- **PolitiFact** — an email inbox; readers send suggestions, editors pick. No form, no status tracking, no promise of coverage.
- **Full Fact** — a WhatsApp tipline ("photo a leaflet, flyer, or local ad") through election windows, framed as signal-building: "We can't fact check everything that is sent in, but everything you do send in helps us to build a picture of the campaign."
- **FactCheck.org** — "Ask FactCheck" reader questions answered as articles; corrections by email.

Common pattern: intake is easy but **deliberately unpromise-keeping** — human triage against editorial priorities. The submission channel is a *radar*, not a service-level agreement.

## Our structural difference

Every site above is bottlenecked by human capacity (~2–10 checks/day), so submissions compete for scarce human attention. **Our pipeline is automated and ingests continuously**: a submitted claim enters the same queue as pipeline-detected claims, gets the same check-worthiness triage, and gets a verdict on the same timeline. The honest contract changes from "we'll consider your suggestion" to "your claim enters the public queue and you can watch its status."

This aligns with the never-trust rule (ADR-0006): a user-submitted quote is **never evidence of what was said**. Submissions are *pointers*; the claim enters the store only when the pipeline ingests the underlying publication itself, extracts the claim from the actual text, and anchors it.

## The mechanism

### One intake surface, two object types

A **"Submit" action** in the site header with two paths:

**1. Submit a source (article, publication, URL)**
- Input: a URL (or pasted text + origin description for offline material — a leaflet, flyer, local-paper ad: exactly Full Fact's "not visible online" case).
- What happens: enters the ingestion queue as a *proposed publication*. From an already-ingested lane (Beehive, RNZ, a tracked broadcaster's YouTube), it merges with the pipeline's own copy; from a new source, the ADR-0013 source-proposal process flags it for a maintainer decision record. The publication page is created immediately in "proposed" state, so the user can watch it move: proposed → ingested → claims extracted → verdicts published.

**2. Submit a claim (a quote or paraphrase)**
- Input: the claim text plus any locating context (who said it, where, roughly when, a link) — all optional except the text.
- What happens: **fuzzy-match against the claim store first** (trigram + semantic, the same index as site search).
  - **Match found** → the existing claim card with its verdict ("already checked"). The majority case in practice and the cheapest service we render.
  - **No match** → a **verification request** on the public record: text, submitter-supplied context, timestamp, and a status anyone can see (`requested` → `located` when the pipeline finds the underlying publication → `checked` when verdicts publish, or `unverifiable` if the source can't be located).

### The locating step is the design's crux

A claim without a verifiable source can't be checked fairly, and anchoring a claim to something the submitter *says* someone said is the worst failure mode (attribution of an unmade claim). So:

- The retrieval loop attempts to **locate the claim in our ingested sources** (full-text + semantic search over publications and transcripts) — most campaign claims surface in multiple ingested outlets within days.
- Located → extracted, anchored to the *actual publication* (with media anchor where applicable), verified normally — the submission becomes a fulfilled request.
- Not located within a defined window (say, 14 days) → **`unverifiable — source not found`**, publicly displayed with the reason. We do not check unverifiable claims; the public record of *why* is itself transparency.
- Locating to **out-of-scope sources** (self-generated transcription would be required — ZB audio-only segments, captionless podcasts — or Māori-language content) → closed as `out of scope` with a link to the scope ADRs.

### What submitters get back

- **A permanent URL** for their submission — status, matching claims found, and (on success) the verdict card(s).
- **An account is required to submit** — email magic link (no password store, no social SSO at launch). The account exists for abuse resistance (one request per claim per account), follow-up questions during intake, and optional status notifications. **The submitter is never published** — submission records carry a submitter account ID internally; the public request page renders no identity, and identity never attaches to claim cards or verdict pages. The claim's public life is independent of who pointed us at it.
- **No public linkage** — the dedup counter ("N people asked about this claim") is computed, not attributed.

### Guided intake — asking for what's missing

An **adaptive multi-step form, not a free-text chat**; required/optional fields change with what the submitter has already provided:

- Pasted a quote but no source → next step asks *where* they encountered it (TV/radio, social, URL field, print/leaflet, "not sure") and *roughly when* — the two fields that most improve locating hit rate.
- Provided a URL but no claim → next step asks what specifically to check (a "select the sentence" affordance when the URL is fetchable).
- Offline item (leaflet, flyer) → photo upload plus origin questions.

Deterministic: each step's fields derive from previous answers; no AI deciding what to ask — the intake asks only what the locating step consumes (who/where/when/what). Two reasons over a chat at launch: it collects the same missing info with none of chat's failure modes (prompt-injection through submission text, PII over-collection, a moderation surface), and every field is purposeful — a chat elicits free-form narrative the pipeline can't anchor anyway. Post-launch, an LLM-assisted single-turn clarifying question is a natural extension ("you said 'a minister said this in an interview' — which broadcaster?"), rendered as a structured prompt, never a scrolling conversation.

### Volume safety and abuse

- **Accounts gate submissions**; rate limiting is per-account, not per-IP; honeypot + signup friction (magic link) stops bulk creation.
- **Rate limits and dedup**: identical/paraphrase submissions collapse into one request with a counter ("18 verification requests" — a genuinely useful demand signal, displayed on the claim card).
- The demand counter feeds **prioritisation**: triage weights check-worthiness *plus* public request volume — the legitimate, party-blind way reader interest enters the queue (the same signal PolitiFact's editors apply manually).
- Accounts with a pattern of unverifiable/abusive submissions are throttled; heavy abuse patterns deferred to post-launch.

### The never-trust boundary, stated in the interface

The form says plainly: *"We don't take anyone's word for what was said — including yours. We check claims against the original published source. Your submission tells us where to look."*

### Contestation is a separate channel

Submitting a claim is not contesting a verdict. Contestation (disagreeing with a *published* verdict, with evidence) runs through the ADR-0002 mechanism and mutates verdicts when validated. The two forms are distinct surfaces, cross-linked.

## What we don't build at launch

- **No WhatsApp tipline** — makes sense where claims circulate offline and can't be auto-ingested; our lanes cover NZ's online campaign surface, and a messaging tipline adds moderation load and PII handling. Revisit if a leaflet/poster problem appears in 2026.
- **No accounts for *reading*** — anyone browses without signing in.
- **No free-text chat intake** — the adaptive wizard collects the same info deterministically; LLM-assisted single-turn clarifying questions are a post-launch extension.

## Summary

**One "Submit" button, two paths, account-gated with guided intake:** a source URL enters the ingestion queue as a proposed publication; a pasted claim fuzzy-matches the corpus first (most requests answered instantly with an existing verdict) and otherwise becomes a public verification request: `requested → located → checked`, or honestly closed as `unverifiable` / `out of scope`. Submissions are pointers, never evidence. Submitters authenticate but are never published. The intake asks only the questions the locating step consumes; the deduplicated request counter is a party-blind prioritisation signal — the automated analogue of the editorial triage the famous sites perform by hand.