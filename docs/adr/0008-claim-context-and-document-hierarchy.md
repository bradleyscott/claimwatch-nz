# ADR-0008: Claim context — discourse window, publication/segment hierarchy, and on-demand depth

*Status: Proposed · Date: 2026-09-08 · Deciders: Bradley, Dave*

*(Consolidates the claim-contextualisation design with the publication/segment document hierarchy; both are context, at different levels.)*

## Context

A claim sentence is not self-contained. "Net migration was 55,000 last year" is a number; whether it is *misleading* depends on the discourse around it — which policy proposal it was deployed to support, what the speaker's argument rests on, whether the speaker was answering a hostile question, and what the immediately preceding sentences established. The pipeline extracts claims from documents; the research literature adds a warning that makes context a **correctness requirement of extraction itself**, not an enrichment: the decomposition literature's error taxonomy (Hu et al., "Decomposition Dilemmas," NAACL 2025) identifies **omission of context** — missing key details and logical relationships — as a primary failure that distorts semantics and can make extracted sub-claims incomplete or misleading.

The evidence base for context as a verification input is strong: Atanasova et al. (JDIQ 2019) measured +4.2 MAP from context features and +1.5 from discourse features on check-worthiness (P@5 collapsed 0.800→0.550 without context); the LIAR datasets record each statement's **context/venue** as a standard verification-relevant field; claim normalization (CheckThat! 2025, 20 languages) formalises projecting an in-context utterance into a standalone verifiable statement; stance detection treats the claim's argumentative position as text-relative and discoverable — not assumable.

An earlier draft of this decision over-committed: it assumed claims arrive in interviews, always deployed in support of policy proposals, with a fixed taxonomy of discourse roles. The corrected design captures context **at three levels, all optional-typed, all published, none assumed**.

## Decision

**Three context levels attach to every claim — publication, segment, discourse window — stored as first-class records, with the verification loop able to pull deeper into any level on demand. The evidence standard never varies with context; all contextual fields are published and contestable.**

```
publication (1) ──< segment (n) ──< claim (n) ── discourse window (1, span)
```

### Level 1 — the publication record (what was this occasion?)

One row per ingested document (created at ingestion), carrying:

- **Provenance**: source ID, canonical URL, retrieval timestamp/method, content hash (per ADR-0002).
- **Publisher metadata**: name, type (broadcaster / party / ministry / outlet / independent), claimant-entity link where the publication is itself the principal.
- **Publication metadata**: type (podcast episode / press release / news article / broadcast segment / Hansard debate / social post), title, publication date (+ event date where they differ), authors/speakers, programme/section, duration/word count.
- **Whole-document summary** (LLM-generated once, batch-priced, neutral): what the publication as a whole is and does, plus topic tags. Reused by every claim from it.
- **For broadcast (ADR-0011)**: transcript tier, transcript provenance, and the full transcript stored once here — claims reference into it.

The publication record is also the unit of document-level dedupe, health checking, and reprocessing. It supplies `speech_context` (the venue/occasion field, per LIAR's schema) — sourced here, not re-derived per claim.

### Level 2 — the segment (the relevant portion)

One row per relevant portion: one interview question and its **complete set of answers**; one section of a policy announcement; one debate exchange. Carrying: span into the publication (timecode per the media anchor, or text range), a **descriptive** (not interpretive) summary of what the portion was, and turn structure where present (the question; the ordered answers). Debate exchanges carry the `responds-to` relationship naturally (ADR-0002). Created only where the publication has detectable structure; an unstructured short article has publication + window and no segment record.

### Level 3 — the discourse window (verbatim, quotable)

The claim's immediate context: containing paragraph(s) (capped span, ~±300 words), the preceding speaker turn where the source has turn structure (the interviewer's question is the single most important contextualiser for spoken claims), document title/headline. A span, not an interpretation — captured deterministically at extraction. For caption-sourced claims (ADR-0011) the window is the surrounding caption cues anchored by the media anchor timestamps.

### Structured context fields (typed, optional, conservative)

At triage, an LLM pass over the window (+ segment/publication summaries as conditioning) extracts **optional, typed fields** — all optional, never guessed (absent = absent, not an inferred default):

- **`speech_context`** — venue/occasion (sourced from the publication record; deterministic).
- **`policy_topic`** (if any) — the policy area the discourse concerns, normalised against the domain taxonomy.
- **`attached_proposal`** (if any) — a proposal/position explicitly referenced in the stored text as supported/attacked by the claim. **Detected only when the window contains it** — never inferred from the speaker's identity or party.
- **`argument_direction`** (if confidently detectable) — whether the statistic is deployed as evidence of a problem or of success. Stance detection over the window; null when not confident.
- **`context_qualifiers`** — qualifications the speaker themselves attached ("up from a low base", "excluding seasonal effects") — the false-alarm protection.

All fields are **extracted-if-present, never assumed**; the classification prompt is published; the auditable artefact is the stored window text itself (the LLM proposes, the window proves).

### How context conditions verification

- **Default context pack (automatic, every verification)**: claim + discourse window + segment summary + publication summary + publication metadata — bounded, cached, batch-priced. Most claims resolve from this.
- **On-demand expansion**: when the default pack leaves a question open, the verification loop may request deeper content — the **full segment** verbatim, the **full publication** (whole transcript/document), or **adjacent segments** in the same publication. Each request is logged with a structured reason: the audit trail shows not just what context was used but *why* the loop went looking. Same principle as the retrieval loop (ADR-0002): the model decides whether its current evidence suffices.
- **Statistical mode (ADR-0002)**: the sensitivity grid stays pre-declared and identical for everyone (the anti-invented-standard defence is untouched). Context enters at presentation only: `argument_direction`/`attached_proposal` select which grid rows are **material to foreground**, and the verdict page renders the **"as deployed" line** — *"the figure is accurate as stated; in support of [proposal], the framing omits [grid finding], which is material to that proposal"* — when a proposal exists; plain grid result otherwise.
- **Open-web loop**: question generation conditions on the context — the loop decomposes the *argument* where one exists (the AVeriTeC multi-hop lesson), the plain claim where none does.
- **False-context mode**: the stored window is the primary instrument — "is real content deployed in a context that changes its meaning?" is exactly the stored window plus retrieval for the original context.
- **What the loop never gets**: claimant identity (the ADR-0002 firewall is absolute, even on demand) and cross-publication content beyond what retrieval legitimately brings.

### Guardrails

- **Context never changes the evidence standard** — the grid, authority map, and verification rules are identical regardless of any context field. Context affects emphasis, question seeds, and presentation; never the criterion.
- **Every context field is published on the verdict page** with the quoted window — the contextualisation is contestable like everything else (standard mutation pathway; ADR-0006). A speaker who disputes the characterisation contests the *context record*.
- **The window is quoted, never paraphrased into the verdict.**
- **No inference from speaker identity** — `attached_proposal` comes from the window text only; party, platform, or history never fill a context field.
- **Timestamp anchoring for caption/video-derived claims** (ADR-0011): utterance start/end times, media URL, deep link — the "hear it / watch it" control. The store's `media_anchor` field (media_url, start_s, end_s, deep_link) + `transcript_tier` field (publisher-reviewed | publisher-auto | self-generated) apply to any claim from audio/video-bearing documents.

## Alternatives considered

- **Verify the sentence in isolation.** Rejected: structurally unable to catch deployment-level misleadingness; and per the decomposition literature, isolation is itself a known extraction error source.
- **The earlier fixed taxonomy** (interview-shaped, always-for-a-proposal, closed role set). Rejected: over-committed assumptions the evidence doesn't support; replaced by optional typed fields with conservative detection.
- **Full-argument reconstruction** (parse the whole speech into an argument graph). Rejected for v1: hallucinated "context" could fabricate positions the speaker didn't hold — the ADR-0011 never-make-claims principle applied to context. Bounded field extraction over the stored window keeps the interpretive step auditable. (Argument chains, where built, assemble from verified artefacts per ADR-0013.)
- **Context classification as a hard pipeline gate** (verification blocks until context resolves). Rejected: context is input enrichment; a claim with null context fields still verifies — the page simply shows no "as deployed" line. Blocking biases toward confidently-classified (simple) claims.
- **Publication-level context only.** Rejected: too coarse — the relevant portion of a 40-minute interview is not the whole episode.
- **Window-only (no publication/segment records).** Rejected: collapses three distinct levels; loses publisher/occasion metadata as first-class records and segment structure that turn-structured sources carry natively.
- **Merging segment into window.** Rejected: they differ in kind — the window is verbatim surrounding text (quotable, auditable); the segment summary is a generated description of a larger span (navigational).
- **Media framing as context** (what coverage said around the claim). Deferred as secondary enrichment.
- **Human editorial context per claim.** Rejected: no editorial staff is the defining constraint (ADR-0001).

## Evidence base

- Atanasova et al., "Automatic Fact-Checking Using Context and Discourse Information" (JDIQ 2019; arXiv:1908.01328): +4.2 MAP context / +1.5 discourse; P@5 0.800→0.550 removed; veracity labels include "Conditionally True" as a first-class class; datasets public.
- LIAR (Wang 2017) / LIAR2: context/venue as standard metadata; speaker credibility history (LIAR2).
- Claim normalization (CheckThat! 2025, 20 languages; Sundriyal et al. 2023): the formalised utterance→standalone-claim projection. In our pipeline, normalisation produces the claim's `text` field from the utterance within the window — and the context hierarchy is what makes that projection auditable. The normalized claim is never the only record: the utterance, window, segment, and publication all remain.
- Hu et al., "Decomposition Dilemmas" (NAACL 2025): omission-of-context as a first-class decomposition failure; inconsistent effect on verification accuracy.
- Stance detection literature (survey arXiv:2506.16383): stance is text-relative and discoverable — supporting detect-only-when-present.
- ClaimBuster (Hassan et al., KDD 2017): the first end-to-end triage system; its context handling was a fixed four-sentence window shown on demand to human labelers (~14% used it). Our design replaces the ad-hoc peek with a persisted, structured, multi-level context model that also informs machine verification.

## Consequences

- **Schema**: `publication` and `segment` tables + `discourse_context` on the claim record (Drizzle, ADR-0007) — publication created at normalise, segments at extraction where structure exists; claims carry `publication_id` + `segment_id?` FKs, the window, the optional context fields, `media_anchor`, and `transcript_tier`.
- **Summaries are one-time per document/segment** (batch-priced, reused by every claim); the incremental cost per claim is a FK reference, not an LLM call.
- **Verdict pages render the context stack**: publication (name, publisher, date, link, summary) → segment (what this portion was, the question, the full answers) → claim with window and "hear it / watch it" anchor. Plus the "Context of the claim" section: window quote, frame fields, "as deployed" line where applicable. From the first published verdicts.
- **Triage gains an optional structured context pass** over the window — Flash-class, batch-priced; fields optional, short-circuits cleanly.
- **The harness measures the layer** (ADR-0005): the NZ-labelled set gains context fields per label; scoring runs as an ablation (with/without context conditioning) — the published number tells us what contextualisation is actually worth.
- **Reprocessing operates at all three levels** (ADR-0002): re-summarised publications/segments regenerate without touching claim extraction; extraction reprocesses against stored summaries.
- **Guardrail posture unchanged**: context conditions presentation and question seeds, never the criterion; party-blind extends to context.