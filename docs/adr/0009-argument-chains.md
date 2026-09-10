# ADR-0009: Argument chains — showing whether claim verdicts are fatal to a proposition

*Status: Proposed · Date: 2026-09-08 · Deciders: Bradley, Dave*

## Context

Verdicts are claim-level, and claims in isolation are only half the picture. A statistic is usually made **as part of an argument for a policy proposal**: "crime is up 30%" → the government's approach has failed → support the proposed sentencing policy. The most useful thing a reader can see is **the reasoning chain and the truthfulness of each claim in the context of that reasoning**: which claims the argument rests on, how each checks out, and whether a claim's verdict is *fatal to the proposition* — a true premise whose framing is incomplete can still break the argument if it was load-bearing.

The single-claim verdict cannot reveal this. A "Supported" verdict on a statistic tells the reader the number checks out; it does not tell them whether the argument built on it survives — the inference may be broken (per-capita crime fell; the rise predates the policy being attacked). Equally, a "Refuted" premise may be peripheral to the argument rather than fatal. Readers evaluating a proposition want the chain, not fifteen disconnected verdicts.

The building blocks all exist: per-claim verdicts, typed claim relationships (ADR-0005), discourse context with detected proposals (ADR-0008), publication/segment structure (ADR-0008). What is missing is the explicit **chain assembly** — and its central risk, identified throughout this project's design history: **reconstructing an argument can fabricate positions the speaker never voiced**. A hallucinated premise node is an unmade claim attributed to a named person — the worst failure mode in the system (ADR-0007's reasoning, applied to structure rather than transcription). The design therefore rests on one load-bearing rule: **chains are assembled from stored, verified artefacts; edges must be grounded in the quoted discourse; nothing is inferred that isn't in the text.**

**Evidence base:** LLM-based argument mining is now a mature research area (survey: arXiv:2506.16383, 2025) — claim extraction, premise–claim relation detection, stance detection, and argument summarisation are all demonstrated components; political-domain argument mining is the standard application domain. Argument mining outputs are treated in that literature as *structured extractions from text* — which is what the grounding rule makes them here. The CheckThat! 2026 Task 3 pipeline (full fact-check article generation with NLI-based citation auditing) demonstrates the assemble-then-audit pattern at article level; we apply the same discipline at argument level.

## Decision

**Argument chains are a post-verification assembly layer that reads the store. They compose verified claim verdicts into the argument structure the discourse actually contains — proposition, supporting claims, and textually-grounded inferential edges — and render it as navigation. No new verdict class; no ungrounded inference.**

### 1. Chain anatomy (nodes and edges, all grounded)

A chain is a directed structure: **proposition node** → **claim nodes** → linked by **inference edges**.

- **Proposition node**: from ADR-0008's `attached_proposal` (detected in the discourse window — never inferred from speaker identity). A proposition with no attached proposal generates no chain; the system does not invent one.
- **Claim nodes**: existing verified claims in the store — chains reference claims by ID; they never re-state, rephrase, or add claims. Every node's verdict comes from the claim's own record.
- **Inference edges**: each edge connects a claim (or the proposition) to the next step, and **must cite the stored text where the connection appears** — the window quote, segment summary, or publication text containing the connective discourse ("which is why we need…", "the result of this failure is…"). Two edge types:
  - **stated** — the discourse itself makes the link ("crime is up 30%, *so* the current approach isn't working"): the edge cites the exact span.
  - **unstated** — the argument depends on a premise the speaker did not voice ("crime is up 30%" → *crime policy isn't working* is implicit). Unstated edges are allowed but **labelled as inferred premises**, rendered distinctly, and carry the note that the speaker did not state them. An unstated edge names what the argument *assumes* — exactly what a reader needs to evaluate — but the label is honest that the assumption is the assembler's reading.

No edge without a textual anchor; no node without a verdict; no proposition without a detected proposal.

### 2. Where chains come from (assembly, not generation)

Chains are assembled **per publication/segment** (ADR-0008): an argumentative release or debate exchange yields one chain; a technical briefing with no argumentative structure yields none, and the system records that. Assembly is an LLM pass over the stored discourse (window text + segment content + publication context — all quotable artefacts), producing a **structured chain record**: nodes = references to existing claim records; edges = {type: stated|unstated-inference, anchor_span, from, to}. The chain record is **immutable extraction output** — versioned, model-attributed, reprocessable like every other pipeline artefact (ADR-0006), and its grounding anchors make it auditable: any edge can be clicked through to the text that justifies it.

- **Cross-publication chains are aggregates, not generated structures**: the "case for X across the campaign" view is assembled by grouping verified claims by `attached_proposal` (ADR-0008) and using the claim graph (ADR-0005's repeats/contradicts) — aggregation over existing records, not generation. It shows how the same statistic was deployed by different speakers, and how the proposition's evidential base evolved.
- **The proposition view aggregates nothing unverified**: if only two claims were ever made for a proposition, the view shows two claims — it never extrapolates the argument beyond what was said.

### 3. Rendering: the argument view

Verdict pages for claims inside a chain render an **argument view**:

- the proposition (quoted from the discourse, with its publication anchor);
- the supporting claims, each carrying its own verdict (clicking through to the full verdict page);
- load-bearing marking: which claims the chain actually depends on (removing which would break the inferential path) — derived structurally from the chain graph, not judged;
- **break marks**: where a load-bearing claim's verdict is Refuted / Not Enough Evidence / accurate-but-incomplete-in-material-ways, the edge it supports is visually marked — the reader sees *where the argument is under strain* without the system issuing a verdict on the argument itself.

The summary line is compositional and factual: *"Three of the five claims this argument rests on are accurate but incomplete in ways material to the conclusion; one is refuted; one is unverifiable."* — no "the argument is unsound" judgement is issued. The reader sees the structure and the verdicts; the reasoning assessment stays with the reader.

### 4. Guardrails

- **No chain without a verified proposition and verified claim nodes.** Empty-shell chains (proposition + inferred premises + no checked claims) are not published — a chain with no verified nodes renders as "claims associated with this proposition are being verified", not as an argument.
- **The chain record is contestable**: "that's not the argument I made" is a standard mutation-pathway contest against the chain record (ADR-0002), with the edge anchors as the audit surface.
- **No argument-level verdict class is added to the harness schema.** The four AVeriTeC classes (ADR-0004) remain the verdict universe; chains compose them. Any future argument-level judgement is a new, separately-harnessed question — not a silent extension.
- **The firewall holds**: chain assembly, like all verification, never receives claimant identity. Chains are assembled from discourse records only.
- **Chain assembly is optional per publication**: only argumentative discourse yields chains; the absence of a chain is recorded as such ("no policy argument attached to this claim in its source discourse") rather than manufactured.

## Alternatives considered

- **Argument-level verdicts** (a fifth verdict class: "the argument is sound/unsound"). Rejected: evaluating reasoning validity is a materially different epistemic claim from fact-checking a statistic; it invites "the fact-checker says my argument is wrong" framing that the claims-not-persons standard exists to avoid. Compositional rendering gives readers the same information without the system adjudicating the inference.
- **Free-form argument reconstruction** (LLM reads the whole speech and generates the argument narrative). Rejected: this is where fabricated positions come from — nodes invented, edges imagined. The store-referencing chain record with textually-anchored edges is the auditable equivalent.
- **Chains only at campaign level** (aggregate "case for X" views, no per-publication chains). Rejected: the campaign-level view is derivable from per-publication chains by grouping; building it first would skip the grounding that makes it trustworthy.
- **Defer entirely to post-election.** Rejected: argument chains are where the verdicts become *useful* rather than merely accurate — and contesting chains generates exactly the interaction data that improves them. Prominence is staged: per-publication chains first (week 4–5 build), cross-campaign proposition views once claim volume accumulates.

## Consequences

- **A new pipeline stage after verification**: chain assembly (batch-priced, Flash-class for simple chains; the assembly pass runs over stored text and emits structured records). Cost is one pass per argumentative publication — small relative to verification.
- **Store schema gains `argument_chain` records** (Drizzle, ADR-0014): nodes referencing claim IDs, edges with anchors, proposition reference, model version. Immutable, reprocessable, contestable.
- **Site feature**: the argument view on verdict pages + the proposition-level cross-campaign view. The "Context of the claim" section (ADR-0008) gains a link to the chain it belongs to.
- **The harness extension**: chain-assembly labels on a subset of the NZ set (does the assembled chain match what human labellers reconstruct from the same discourse?) — measured before the feature is prominent on the site.
- **The trust posture is unchanged**: verdicts remain claim-level and harness-gated; chains are records of what was argued, composed from verified parts, contestable end-to-end. What the reader gains is the reasoning context that makes a verdict's *significance* visible — the difference between a database of checked claims and a tool for evaluating policy argument.