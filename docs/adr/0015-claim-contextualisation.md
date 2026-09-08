# ADR-0015: Claim contextualisation — the discourse window that informs verification

*Status: Proposed · Date: 2026-09-08 · Deciders: Bradley, Dave*

## Context

A claim sentence is not self-contained. "Net migration was 55,000 last year" is a number; whether it is *misleading* depends on the discourse around it — which policy proposal it was deployed to support, which policy assumptions the speaker's argument rests on, whether the speaker is attacking the government's record or defending their own, and what the immediate conversational move was (a question answered, an attack answered, a proposal introduced). The same number supporting a "cut the intake" proposal reads differently from the same number defending "record arrivals under our plan."

The current design verifies claims as extracted sentences: triage detects a checkable claim, fingerprint-matches it, and runs the grid or loop. What is missing is **the contextualisation stage** — capturing the surrounding discourse at ingestion so verification can ask not just "is this number accurate?" but "is this number, as deployed here, misleading?" Without it, two failures occur: (a) a selective statistic is verified "accurate" because the sentence is true, when its *deployment* was misleading; (b) context that would excuse a claim (a speaker immediately qualifying their own figure) is lost, producing false alarms. Both are verification errors caused by treating the claim sentence as the whole utterance.

This ADR defines how context is captured, structured, and fed to verification. It composes with the existing designs: the sensitivity grid already answers "is the framing representative of the field?" (ADR-0004) — contextualisation answers "what was the speaker using the framing to do?"

## Decision

### 1. Capture the discourse window at extraction, not at verification

Every extracted claim carries a **discourse window**: the surrounding text the claim appears in, captured at extraction time from the source document — the speaker's full paragraph(s) around the claim, the question that prompted it (for interviews/Hansard, the preceding speaker turn), and document metadata (title, section, release/programme type). This is cheap and deterministic: the extractor already has the document; the window is a span, not an interpretation. The claim record stores the window (capped, e.g. ±500 words or the containing speaker turn), so verification never has to re-fetch and re-scope.

- **Broadcast/clip claims (ADR-0014)**: the window is the surrounding caption cues (say, ±30s or the whole speaker turn), anchored by the media_anchor timestamps already stored.
- **Releases/articles**: the window is the section/paragraph block around the claim plus the document title and headline.
- **Interviews with turn structure** (transcripts, ZB/RNZ segments): the window includes the interviewer's question — the single most important contextualiser for spoken claims ("Isn't it true that crime is up?" produces a different discourse position than an unprompted assertion).

### 2. Structure the context: the policy-support frame

At triage, the LLM classifies the claim's **discourse role** from the window — what the claim is doing in the surrounding argument. Structured output (Zod, per ADR-0013), fields:

- **policy_proposal**: the proposal/position the claim supports or attacks, in neutral phrasing ("opposes the bed tax", "proposes cutting the ETS review") — or none if purely retrospective.
- **policy_assumptions**: the implicit premises the speaker's argument rests on ("immigration is too high", "crime is rising due to this government") — the bridge from statistic to proposal.
- **discourse_role**: `supports-own-proposal` / `attacks-opponent-record` / `defends-own-record` / `responds-to-question` / `answers-criticism` / `neutral-statement`.
- **direction**: is the statistic being framed as evidence *of a problem* (bad number → change needed) or *of success* (good number → stay the course)?
- **attributed_to_party_position**: whether the argument is the speaker's own platform or a characterisation of an opponent's.

These fields are **extracted, not judged** — they describe the discourse structure, they do not evaluate it. The classification is conservative: low-confidence roles are recorded as `unclassified` rather than guessed (the ADR-0010 never-guessed rule applied to context).

### 3. How the context informs verification (per mode)

- **Statistical claims (ADR-0004 engine)**: the grid already computes whether the framing is representative of the field. Context sharpens two steps:
  - **Grid-row materiality**: the discourse role determines which grid alternatives are *material to check*. A number framed as evidence of a crisis ("record crime!") makes the long-window and per-capita rows decisive (does the record hold over 10 years? per 100k?); a number offered as a success claim makes the denominator-family row decisive (is the metric one the field considers valid?). The context selects which grid rows the verdict page foregrounds — the grid itself stays pre-declared and identical for everyone (the anti-invented-standard defence is untouched).
  - **The "deployed as" line**: the verdict page shows the policy proposal the statistic was supporting, and states the verdict against *that deployment*: "accurate as stated; as deployed here (supporting X), the framing omits Y, which is material to X." The reader sees both the number's status and its use.
- **Citation-backed claims**: the window reveals whether the citation is doing direct work (proposal cites the study) or decorative work (study mentioned as colour) — which changes how hard the citation check binds.
- **Open-web loop claims**: the policy assumptions field seeds question generation — the loop decomposes the *argument*, not just the sentence (e.g. "does cutting the ETS review change emissions outcomes?" is a better retrieval question than the quoted sentence). This is the AVeriTeC multi-hop lesson (ADR-0011) applied with context: question generation conditions on the discourse role.
- **False-context / decontextualisation mode (ADR-0004)**: the discourse window is the primary instrument — the mode's core question is "is this real content deployed in a context that changes its meaning?", which is exactly the stored window plus retrieval for the original context.

### 4. What context is NOT allowed to do (guardrails)

- **Context never changes the evidence standard.** The grid, the authority map, and the verification rules are identical regardless of discourse role — a government statistician's number and an opposition attack number run the same grid. What varies is presentation emphasis and question-generation seed, never the criterion.
- **Discourse classification is published on the verdict page.** The reader sees the captured window (quoted, with the media anchor per ADR-0014) and the extracted discourse role — so the contextualisation itself is contestable like everything else. A speaker who disputes the characterisation ("I wasn't framing it as a crisis") can contest the *context record* through the standard mutation pathway.
- **The window is quoted, never paraphrased into the verdict.** The verdict's "as deployed" language references the stored window text; the LLM proposes the framing characterisation, the auditable artefact is the window itself.
- **Party-position classification stays out of verdict weighting** — consistent with SOURCE-TAXONOMY's rule that political-position metadata informs auditing, never verdict computation. The discourse role is about *this sentence's* argumentative function, not the speaker's politics.

### 5. Context in the store and on the page

The claim record gains a `discourse_context` object: `{ window_text, window_span, prompt_turn?, discourse_role, policy_proposal, policy_assumptions[], extraction_model_version }`. Verdict pages render a "Context of the claim" section: the quoted window, the speaker's stated purpose (the proposal), and the verdict's "as deployed" line. Repeat claims (ADR-0010 relationships) compare discourse contexts — the same statistic deployed under different proposals appears as one claim with multiple deployment contexts, which is precisely the fuller picture the linking system is for.

## Alternatives considered

- **Verify the sentence in isolation (status quo).** Rejected: structurally unable to catch deployment-level misleadingness — the class the project exists for. The grid partially covers it (representativeness of the field) but misses the proposal-connection entirely.
- **Full-argument reconstruction** (parse the speaker's whole speech/release into an argument graph, verify the argument). Rejected for v1: high LLM cost and the inference chain is exactly where hallucinated "context" could fabricate positions the speaker didn't hold — the same never-make-claims principle as ADR-0014, applied to context. The structured role-classification keeps the LLM's interpretive step bounded and auditable (the window text is stored; the role label is checkable against it).
- **Human editorial context-writing per claim.** Rejected: no editorial staff is the project's defining constraint (ADR-0001); the LLM-proposed + auditable window approach is the automatable equivalent.
- **Context from retrieved coverage only** (what the media said around the claim). Deferred as a *secondary* context source: what matters most is the claimant's own deployment; media framing is a later enrichment, not the primary context.

## Consequences

- **Triage gains a structured discourse-role output** — Flash-class cost (one more Zod field set per claim), batch-priced like the rest of triage.
- **The claim record schema gains `discourse_context`** — defined in `packages/store` (Drizzle), populated by triage, immutable like the rest of the extraction outputs, reprocessable like them.
- **The verdict page template gains the "Context of the claim" section** — window quote + discourse role + "as deployed" verdict line. This is a site feature from the first published verdicts, not a later enhancement, because the verdict vocabulary ("accurate but incomplete — material to this deployment") depends on it.
- **Harness implication (ADR-0008)**: the NZ-labelled set gains a discourse-role field per label — the stratification can then measure whether contextualisation improves verdict quality (does knowing the deployment change the verdict distribution?). The harness runs with and without context as an ablation — that number tells us what the context layer is actually worth.
- **Guardrail posture is unchanged**: context sharpens question-generation and presentation; it never biases the evidence standard, the grid, or the criterion. The party-blind rule extends to context: the same claim text in the same discourse role gets the same verification regardless of speaker.