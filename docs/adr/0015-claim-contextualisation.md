# ADR-0015: Claim contextualisation — discourse context as a first-class input to verification

*Status: Proposed · Date: 2026-09-08 · Deciders: Bradley, Dave*

## Context

A claim sentence is not self-contained. "Net migration was 55,000 last year" is a number; whether it is *misleading* depends on the surrounding discourse — which policy proposal it was deployed to support, what the speaker's argument rests on, whether the speaker was answering a hostile question or making an unprompted claim, and what the immediately preceding sentences established. The current design verifies extracted sentences: triage detects a checkable claim, fingerprint-matches it, and runs the grid or loop. What is missing is a **contextualisation stage** — capturing and structuring the surrounding discourse so verification can ask not just "is this number accurate?" but "is this number, as deployed here, misleading?"

Two failure modes follow from verifying the sentence in isolation:

- **False negatives**: a selective statistic is verified "accurate" because the sentence is true, when its *deployment* was misleading — the class the project exists for.
- **False alarms**: qualifying context is lost ("that was the figure at the time — it has since improved, which is why I opposed the cut") and the verdict reads the claim as worse than it was.

There is also a structural warning from the research literature: the Decompose-Then-Verify paradigm's own error analysis (Hu et al., "Decomposition Dilemmas," NAACL 2025) identifies **"omission of context information" — missing key details and logical relationships — as a primary decomposition failure that distorts semantics** and can make sub-claims incomplete or misleading. Our pipeline extracts claims from documents; that failure mode applies to us directly. Context handling is not an enrichment — it is a correctness requirement of the extraction stage itself.

This ADR supersedes the initial contextualisation sketch, which over-committed: it assumed claims arrive in interviews, always deployed in support of policy proposals, with a fixed taxonomy of discourse roles. The evidence base shows a different shape.

## What the research supports (evidence base)

1. **Context measurably improves fact-checking** — the foundational result is Atanasova et al., "Automatic Fact-Checking Using Context and Discourse Information" (JDIQ 2019): modelling the claim **in the context of the full intervention and the previous/following turns** improved check-worthiness detection by **+4.2 MAP from context features, +1.5 from discourse features**; P@5 dropped 0.800→0.550 when context was removed. Context+discourse features *alone* matched ClaimBuster. The mechanism generalises: the claim's neighbours carry information the claim sentence lacks.
2. **Context is a standard metadata dimension of the canonical datasets**: LIAR records each statement's *context/venue* ("stated in a Fox News interview", "presidential announcement speech") as a first-class field alongside speaker, party, and history; LIAR2 adds speaker credibility history and justifications. The field's existence signals that the community treats the *venue/occasion of a claim* as verification-relevant — the same statistic said in a press conference vs a TikTok is a different fact-checking object.
3. **Stance detection is the mature adjacent task** (survey: arXiv 2506.16383): identifying an author's position *toward a target* (pro/con/neutral), with conversational-context stance detection an active sub-field. The framing of ADR-0015's first draft — classifying what the claim "supports or attacks" — is stance detection, and the research treats it as a *property of the text relative to a target*, discoverable when the text carries the signal, not assumable.
4. **Claim normalization (CheckThat! 2025, 20 languages)** formalises the operation that makes context usable: transform a noisy in-context utterance into a **concise, standalone, verifiable statement**. This is the pipeline operation that reconciles "context matters" with "the loop needs an atomic claim" — normalisation is a *lossless-as-possible* projection of the utterance out of its discourse, and its errors are the known hazard.
5. **The decomposition hazard is measured**: "Decomposition Dilemmas" (NAACL 2025) shows decomposition's effect on final fact-checking accuracy is *inconsistent* — gains on complex inputs, degradation on simple ones, with omission-of-context errors the identified mechanism. Design consequence: **the utterance and its context must remain the verifiable artefacts alongside the extracted claim**, never discarded after extraction.
6. **The claim's own veracity schema must include context-dependence as a first-class outcome**: the community QA annotation in Atanasova et al. uses labels including "Factual — Conditionally True (true in some cases, false in others, depending on conditions the answer does not mention)". Our verdict vocabulary (ADR-0004/0006) already has "accurate but incomplete"; this research confirms context-conditionality is a *recognised verdict class*, not a judgement call bolted on.

## Decision

**Every claim record carries a stored discourse window; the window is structured into typed, low-commitment contextual fields that condition retrieval and presentation; the evidence standard never varies with context; and all contextual fields are published and contestable.**

### 1. The discourse window (capture, not interpretation)

Every extracted claim stores the **surrounding text it appeared in** — captured deterministically at extraction:

- the containing paragraph(s) (capped span, e.g. ±300 words);
- for turn-structured sources (Hansard, transcripts, interviews): the **preceding speaker turn** — for ADR-0014 caption claims, the surrounding caption cues anchored by `media_anchor`;
- document-level metadata: title/headline, section, venue type (release / debate / interview / press conference / article / social post).

This is a *span*, not an interpretation — the extractor already has the document, the cost is near zero, and it preserves exactly what later stages need. **Every claim gets a window; nothing is assumed about its shape.**

### 2. Structured context fields — typed, bounded, and conservative

At triage, an LLM pass over the window extracts **optional, typed fields** — all optional, all low-commitment:

- **`speech_context`** (from LIAR's schema): venue/occasion of the statement — "press release", "debate", "interview on RNZ Morning Report", "social media post". Deterministic from the source; no inference needed.
- **`policy_topic`** (if any): the policy area the surrounding discourse concerns ("housing supply", "sentencing"). Free-text, normalised against the domain taxonomy.
- **`attached_proposal`** (if any): a proposal/position explicitly referenced in the window as supported/attacked by the claim. **Detected only when the window contains it** — never inferred from the speaker's identity or party. A statistic in a technical briefing and the same statistic in a campaign ad produce different records, and neither is assumed absent when present or present when absent.
- **`argument_direction`** (if detectable): whether the statistic is deployed as evidence of a problem or of success. This is stance detection over the window — recorded only at confident levels, else null.
- **`context_qualifiers`**: qualifications the speaker themselves attached in the window ("up from a low base", "excluding seasonal effects", "under the policy we campaigned on") — this is the false-alarm protection: a claim the speaker already qualified verifies against the qualified form.

All fields are **extracted-if-present, never assumed**: the schema is optional-typed throughout, and the never-guessed rule (ADR-0010) applies — an absent field is an absent field, not an inferred default. The classification prompt is published, and the fields are auditable against the stored window (the LLM proposes; the auditable artefact is the window text itself).

### 3. How context conditions verification (per mode)

- **Statistical claims (ADR-0004 engine)**: the sensitivity grid remains pre-declared, identical for every claimant, and computed from the fingerprint alone. Context enters at two points, presentation-level only:
  - **Grid-row emphasis**: `argument_direction` and `attached_proposal` determine which grid alternatives are *material to foreground* on the verdict page (a number framed as crisis evidence foregrounds the long-window and per-capita rows; a success claim foregrounds the denominator-family row). The grid is computed fully either way — context selects what the page leads with.
  - **The "as deployed" line**: when `attached_proposal` exists, the verdict page states the deployment: *"The figure is accurate as stated; in support of [proposal], the framing omits [grid finding], which is material to that proposal."* When no proposal is attached, the page simply reports the grid result against the framing.
- **Citation-backed claims**: the window shows whether the citation does direct argumentative work or decorative work — which sets how strictly the citation-check binds (a decorative mention failing a full check yields "the cited source does not support the framing").
- **Open-web loop**: question generation conditions on the window — the loop decomposes the *argument* where one is present (per AVeriTeC's multi-hop finding, ADR-0011), and the plain claim where no argumentative frame exists.
- **False-context / decontextualisation mode (ADR-0004)**: the stored window is the primary instrument — the mode's core question ("is real content deployed in a context that changes its meaning?") is exactly the stored window plus retrieval for the original context.

### 4. Guardrails

- **Context never changes the evidence standard.** The grid, authority map, and verification rules are identical regardless of any context field — a crisis-framed number and a success-framed number run the same grid. Context affects emphasis, question seeds, and page presentation; never the criterion.
- **Every context field is published on the verdict page** with the quoted window — so the contextualisation itself is contestable like everything else. A speaker who disputes the characterisation ("I wasn't attaching it to that proposal") contests the *context record* through the standard mutation pathway (ADR-0005).
- **The window is quoted, never paraphrased into the verdict** — the LLM proposes field values; the auditable artefact is the stored window text.
- **No inference from speaker identity.** `attached_proposal` comes from the window text only — the speaker's party, platform, or history never fills a context field. (The firewall from ADR-0010 — verification never receives claimant identity — is preserved.)

### 5. Schema and rendering

The claim record gains `discourse_context`: `{ window_text, window_span, prompt_turn?, speech_context?, policy_topic?, attached_proposal?, argument_direction?, context_qualifiers[], extraction_model_version }` — all optional except the window. Verdict pages render a **"Context of the claim"** section: the quoted window (with media anchor where applicable per ADR-0014), the extracted frame fields, and the "as deployed" verdict line. Repeat claims (ADR-0010) compare discourse contexts: the same statistic deployed under different proposals is one claim with multiple deployment contexts — the fuller picture the linking system exists for.

## Alternatives considered

- **Verify the sentence in isolation (status quo).** Rejected: structurally unable to catch deployment-level misleadingness, and — per the decomposition literature — the isolation itself is a known error source (omission-of-context distorts the extracted claim).
- **The initial fixed taxonomy** (interview-shaped, always-for-a-proposal, closed role set). Rejected: over-committed assumptions the evidence doesn't support; replaced by optional typed fields with conservative detection.
- **Full-argument reconstruction** (parse the whole speech/release into an argument graph). Rejected for v1: high cost, and the inference chain is where hallucinated "context" could fabricate positions the speaker didn't hold — the ADR-0014 never-make-claims principle applied to context. Bounded field extraction over the stored window keeps the interpretive step auditable.
- **Stance/proposal classification as a hard pipeline gate** (verification blocks until context resolves). Rejected: context is *input enrichment*; a claim with null context fields still verifies — with the page simply not showing an "as deployed" line. Blocking would make the pipeline brittle and bias toward confidently-classified (probably simple) claims.
- **Media framing as context** (what coverage said around the claim). Deferred as secondary enrichment — the claimant's own deployment is primary; retrieved framing is a later addition.
- **Human editorial context per claim.** Rejected: no editorial staff is the defining constraint (ADR-0001); LLM-proposed fields over a stored, quotable window is the automatable equivalent, auditable like every other pipeline output.

## Evidence base

- Atanasova et al., "Automatic Fact-Checking Using Context and Discourse Information" (JDIQ 2019; arXiv:1908.01328): context features +4.2 MAP / P@5 0.800→0.550 removed; discourse features +1.5 MAP; both critical to state-of-the-art check-worthiness; veracity annotation includes "Conditionally True" as a first-class label. Datasets/code public.
- LIAR (Wang 2017) / LIAR2: context/venue as a standard verification-relevant metadata field; speaker credibility history added in LIAR2.
- CheckThat! 2025 Task 2 (claim normalization): the formalisation of projecting an in-context utterance to a standalone verifiable statement — 20 languages, active task.
- Hu et al., "Decomposition Dilemmas" (NAACL 2025): decomposition error taxonomy with omission-of-context as a first-class failure mode; inconsistent effect on verification accuracy — granularity must be balanced.
- Stance detection literature (survey arXiv:2506.16383): stance is text-relative and discoverable, including in conversational context — supporting the "detect only when present" posture.

## Consequences

- **Triage gains an optional structured context pass** over the stored window — Flash-class cost (per ADR-0007), batch-priced; fields optional, so the pass short-circuits cleanly when the window carries no signal.
- **The claim record schema gains `discourse_context`** — defined in `packages/store` (Drizzle), populated by triage, immutable extraction output, reprocessable like all others (ADR-0011).
- **The verdict page template gains the "Context of the claim" section** from the first published verdicts — window quote, frame fields (where present), "as deployed" line when applicable. The verdict vocabulary ("accurate but incomplete — material to this deployment") depends on it.
- **The harness measures the layer** (ADR-0008): the NZ-labelled set gains context fields; scoring runs as an ablation (with/without context conditioning) — the published number tells us what contextualisation is actually worth rather than assuming it.
- **Guardrail posture unchanged**: context conditions presentation and question seeds, never the criterion. Party-blind extends to context — same claim text in the same window gets the same verification regardless of speaker.