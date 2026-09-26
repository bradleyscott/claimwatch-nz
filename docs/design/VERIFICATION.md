# Verification engine design

*ADRs: 0001, 0005, 0008, 0011, 0018. Companions: `ARCHITECTURE.md`, `VALIDATION-SLICE.md`, `TEST-STRATEGY.md`, `CROSS-CUTTING.md`.*

## 1. Purpose and slice scope

The verification engine turns triaged claims into a verdict, a confidence, an evidence pack, and an audit
result, and appends them to the store (ADR-0005). It has several modes because misleading-information
classes differ in mechanism (`MISINFO-TAXONOMY.md`). Two findings from the research shape it.

First, **retrieval is the main bottleneck** — gold evidence lifts accuracy by 14 to 22 points — so
every mode that can anchor to a specific source does. Second, **claim against a specific source beats
claim against the open web**, so the open-web loop is the capped catch-all rather than the default.

| Mode | Claims routed | Slice exercise |
|---|---|---|
| Stat-engine grid | statistical (R2) | fingerprint + sensitivity grid over official series |
| Citation-check | institution claims (R6) | fetch cited doc, claim-vs-source |
| Quote-fidelity | broadcast claims (R3) | claim text vs Tier-2 caption text |
| Provenance | false-context samples (R5) | curated ~10-item set only — demonstrate, never production-ready |
| Open-web loop | everything else | capped, labelled, most visibly open to contest |

All modes share the same spine: question decomposition, retrieval depth capped by confidence (the FIRE
pattern, which cut LLM cost 7.6× and search cost 16.5×), per-lane fallback logging from the extraction
ladder, evidence packs with vintages and Internet Archive snapshots, and the **NLI audit as the
publication gate** — it runs before publication, not after.

Other components own extraction (ingestion), claim detection and typing (triage), post-publication
mutation (contestation), and the harness.

## 2. Design

### 2.1 Mode routing

Triage assigns the claim type, and the engine routes on it — a pure function of the claim record. No
claimant identity enters (ADR-0005).

```
statistical → stat-engine grid · citation-backed → citation-check · quote-fidelity → quote-fidelity
false-context → provenance (curated only) · other → open-web loop (capped)
```

A misroute is a failure in its own right. The routing decision is stored on the evidence pack so L3 can
measure per-mode accuracy on the stratum the claim was *routed* to, and catch routing drift. Since
September 2026 the decision is also stored on the **claim** (`claim.verification_mode`) and published
on the verdict page, which picks its explanation of the check from it. The site cannot re-derive a
statistical claim's mode, because that one depends on an authority-registry lookup the reader cannot
see.

**No mode tests causation.** Of the 500 AVeriTeC dev claims, 54 (11%) are causal, and the five modes
above test numbers, documents, quotations, and context attachments. None establishes that one thing
caused another. We publish that gap rather than paper over it: every mode's section on the verdict
page states what its check cannot establish, and the open-web bound names causation explicitly, so a
causal claim graded on timing evidence says so on the page instead of being silently over-read.

A purely causal claim is currently typed `other` and sent to the open-web loop, where its timing
evidence is reported as timing and the causal claim inside it is left unassessed. Closing the gap means
a sixth mode — pre-trend tests, an unaffected comparison group, or difference-in-differences against a
series the intervention did not touch — with its own trail section. Until then the gap is stated on the
page and on `/methodology`, and it is not treated as covered.

### 2.2 Stat-engine grid mode (flagship)

1. **Fingerprint match** — against the claim-anchored evidence store; hit → resolve from accumulated versioned series; miss → retrieve from verifier authorities per the domain's authority map. Retrieval resumes from stored evidence; it does not restart.
2. **Series retrieval** — official series only (Stats NZ SDMX/JSON, policedata.nz, MoJ, Treasury…), stored as `evidence_item` rows with `vintage_date` + `archive_snapshot_url`. The release's own cited numbers are never the evidence — we reconstruct the field.
3. **Sensitivity grid** — pre-declared axes (`grid_axes_version`), computed on demand: window variants with endpoint-trick detection, raw vs per-capita, denominator family, comparison cohorts, seasonality. The LLM selects which rows are **material** to the claim's deployment; it never authors the grid. Identical axes for every claimant — the anti-invented-standard defence.
4. **Verdict.** Robust across the grid → Supported. Material alternatives contradict the impression →
   Conflicting Evidence–Cherry-picking ("accurate but incomplete"). No canonical series → Not Enough
   Evidence, which we treat as visibly lower-reliability. A number that matches *no* grid row is Refuted,
   not cherry-picked: the boundary between classes is arithmetic. A true but selective number is never
   called "false". The "as deployed" line renders only when `attached_proposal` exists; absent stays
   absent rather than defaulting.
5. Presentation: chart-first, alternatives table, grid axes shown on the verdict page.

### 2.3 Citation-check mode

For claims paired with their own evidence (institution lane; also any claim citing a source):

1. **Fetch the cited document** server-side (fetch-from-source; paywalled cited sources degrade to quoted-claim-only, never circumvention).
2. **A bounded claim-against-source comparison.** Does the document say what the claim says it says —
   the numbers, period, population, direction? This is an extraction-precision task (Sonnet-class
   routing, harness-gated), not open-web reasoning. Whether the citation does real argumentative work or
   is decorative sets how strictly the check binds.
3. **Authority discipline**: the cited document is the *object of the check*, never evidence. An NZ Initiative statistic that is statistical checks against Stats NZ via 2.2. Advocacy data is at best A6, never a verdict basis (ADR-0018).
4. Verdict: Supported/Refuted against the source's actual content; a mismatch is the finding, stated claim-vs-source, never as characterisation of the claimant.

### 2.4 Quote-fidelity mode

For caption-sourced broadcast claims (ADR-0007):

1. **Input posture**: claim record carries `media_anchor`, `transcript_tier`, stored cue span.
2. **Comparison**: claim wording against stored caption text — fidelity to *the record we hold*, never to the audio (no self-generated transcription exists). Known ASR hazard classes: homophones, punctuation/segmentation, number formatting, te reo passages.
3. **Guardrails carried into the verdict**: caption text is a claim pointer, never evidence for a quoted number — numerical claims route to 2.2 regardless; wording-critical claims get "verification limited to the quoted claim"; verdict pages state wording rests on unreviewed ASR and link the video + timestamp.
4. **media_anchor generation** for claims arriving without one: built only from stored cue timestamps. A claim that cannot be anchored publishes as an open question, not a verdict with a dead-end quote.
5. Tier-2 fallback rate for caption parsing logged per lane; quote-fidelity verdicts carry the `caption_quality_flag`.

### 2.5 Provenance mode (curated set only)

Instrument: stored discourse window (ADR-0008) + retrieval of the original context (date, source, place), compared to claimed context (the dominant EU-2024 class — decontextualisation, 59.3%). Verdict vocabulary: "false context" as first-class finding — genuine content, wrong when/where/who, true context shown.

**Posture**: least mature mode. Runs on the curated fixture set only (`is_curated_fixture=true`); no lane health, no scheduler, no alerting; produces per-stratum numbers and a demonstration path; the methodology page says exactly that. No live false-context detection is claimed.

### 2.5a Open-web loop (the capped catch-all)

FIRE-style per ADR-0006: question generation beats claim-string search (decompose the *argument* where one exists, conditioned on the context pack); multi-hop conditional retrieval; hybrid store search (pgvector + FTS) then search APIs; **confidence-capped dynamic depth**. Least reliable mode (AVeriTeC ceiling applies) — capped, labelled, most visibly open to contest; the AVeriTeC regression target from week 1.

### 2.6 Shared spine

| Element | Behaviour |
|---|---|
| Context pack | claim + window + segment/publication summaries + metadata (ADR-0008 default pack); on-demand expansion logged with structured reason. Claimant identity never enters. |
| Question decomposition | per-mode seeds; open-web decomposes the argument |
| Confidence-capped depth | cap config per mode; cap binding stored on the pack (a capped run is visible, not silent) |
| Extraction-ladder fallback logging | every evidence fetch runs the ladder; Tier-2 events land in `fallback_log` per lane |
| Evidence-pack assembly | items with vintage + archive snapshot, grid result, justifications, NLI outcome; append-only, pinned by the verdict version |
| Abstention | below-threshold claims publish as open questions (ADR-0001/0004) — a measured capability, not a failure |

### 2.7 NLI publication gate

Every justification sentence must be entailed by its cited evidence before publication — not a sampled retrospective check (that exists separately for mutations, ADR-0002).

- NLI pass over (sentence, cited-span) pairs, schema-constrained; non-entailed sentences block publication and route to the review queue.
- **One call per pack, not per sentence** (Sept 2026): the gate previously cost one sequential call per justification for one gate decision. A batched response that does not carry a verdict for every sentence is treated as a gate failure, never as an implicit pass; a single-justification pack keeps the single-pair call and prompt shape unchanged.
- Also enforces attribution discipline: no unattributed synthesis; arithmetic stated explicitly (AVeriTeC annotation protocol).
- Audit failure rate is a page-level Grafana metric.
- Stated honestly: the auditor is itself an LLM. The harness calibrates it (must-pass/must-fail packs at L1; audit-agreement on labels at L3) — a gate on the worst hallucinations, not proof of entailment.
- Models per ADR-0011 routing, harness-gated; prompts versioned files; adjudication batch-routed with realtime escalation for publish-day verdicts. The **verdict tier and this gate run on the mid-tier model, not the research tier's cheap model** — a gate is exactly where a cheap model is expensive.

### 2.7a Class-agreement gate (Sept 2026, VER-R16)

The verdict class is decided **twice**, and only a class both runs produce is published. A
disagreement publishes nothing, and is counted.

This exists because the obvious alternative does not work. The configured models discard the sampling
settings — the SDK warns that `claude-sonnet-5` ignores `temperature` and that the OpenRouter research
model ignores `seed` — so identical input moved a class between runs: `not_enough_evidence` once,
`supported` twice, with the NLI gate passing every time. When no knob can pin the sampler, the thing to
pin is the decision. A class two independent runs agree on is a class the pipeline can defend, and a
disagreement measures how unstable that decision is rather than producing a class to publish.

- **Where it applies**: the class-deciding step — the low-volume call that produces what a reader sees. Deliberately **not** triage, which runs once per sentence per document and would multiply the dominant cost; the triage boundary is measured and disclosed instead (TRIAGE open question 9, and the page states that what-can-be-checked is a model's judgement).
- **The first run's outcome is the published one**, so the published reason comes from a run whose class agreed, and the choice is predictable rather than "whichever agreed".
- **A failed call is not a disagreement.** Provider errors propagate; counting them as instability would inflate the signal with outages and hide the real failures.
- **Two runs is a floor, not a default**: a one-run gate would agree with itself by construction.
- Disagreement rate is the calibration signal for whether a decision is trustworthy enough to publish, and belongs beside the audit failure rate on the same page-level metric.

### 2.8 Model tiers (ADR-0011 provisional routing, Sept 2026)

The routing table is tiered by *what the output is used for*, not by how hard the task looks:

- **Research tier** (`claim-decompose`, `research-assess`, `authority-classify`, `open-web` depth control) — ~80% of the calls per claim. Its output is a control signal: which questions to search, whether the evidence meets the sufficiency bar, which gaps remain. Its `confidence` is neither published (SIT-R6 withholds confidence entirely) nor written to a verdict, and its `verdictSignal` is not consumed. A weaker model here costs rounds and searches, bounded by `MAX_SEARCHES`/depth cap, and degrades to *not enough evidence* — an honest abstention rather than a fabricated verdict.
- **Verdict tier** (`citation-compare`, `quote-fidelity`, `grid-materiality`) and the **publication gate** (`nli-audit`) stay on the mid-tier model. `grid-materiality` never authors the grid (VER-R11) but selects which rows count as material, and `quote-fidelity` produces a published verdict.
- **Evidence-fetch fan-outs are bounded for the same reason the tiers are split:** one search query is one set of organic results, and one classification call covers the whole surviving set (`vetting.ts`), with the result count requested from the provider capped (`SERPER_RESULTS`). Authority discovery is skipped entirely for claim types that can never route to the stat-grid.

Measured effect at the September-2026 volumes (~15 calls/claim → 7): **$0.043 → $0.014 per claim, −68%**, with the verdict tier unchanged. These are code-shape estimates from the call fan-out, not harness numbers — the harness run that confirms accuracy parity per role is still outstanding (ADR-0011 rule 3 of its decision rule), and is an L3 gate before launch.

## 3. Interfaces

### 3.1 Inputs from triage

| Field | Contract |
|---|---|
| claim record | text, type (routes the mode), fingerprint, embedding, FKs |
| discourse context | window (verbatim) + optional typed fields — all nullable, never defaulted; the engine treats absent as absent |
| media fields | `media_anchor`, `transcript_tier`, `caption_quality_flag`, cue span |
| dedupe inputs | fingerprint matches into the evidence store (resume fast path) |
| explicitly absent | claimant identity, reliability profile (firewall), label data (blind rule) |

### 3.2 Outputs to the store

| Object | Contract |
|---|---|
| `verdict_version` (v1) | four classes + pledge/conditional, confidence, status; below-threshold → open questions |
| `evidence_pack` | items + grid result + justifications + NLI outcome; append-only, pinned by the verdict version |
| `evidence_item` | authority ref, series/document identity, `vintage_date`, URL, `archive_snapshot_url`, hash, version — one row per fetched version |
| `verdict_provenance` | pipeline/prompt/model versions, search refs, token/latency spans (cost via price map) — rendered as the site's provenance block |
| `fallback_log` | per-lane Tier-2 events |
| open-question record | below-threshold claims with the pack attached, inviting contest |

### 3.3 Search APIs (ADR-0011)

- **Brave primary** (Goggles map onto A1–A6 authority restriction), **Serper fallback/bulk**. Which is primary is routing config, not code.
- Query-level control is the requirement: black-box grounding rejected because evidence-pack reproducibility needs it for the grid and authority restriction.
- Every call token/latency-telemetered via gen_ai spans (cost applied at aggregation from the price map — CROSS-CUTTING §5.3); queries + result URLs recorded on the pack so the retrieval path is auditable and re-runnable.

### 3.4 Official series (authority map)

- Series fetched per SOURCE-TAXONOMY Part 2 with declared primary authority, alternates, denominator family.
- **Precedence**: A1 > A2 > … > A6 — but the conflict is often the finding: verdicts cite the claim's own tier first, then the higher authority; the verdict is about the gap. Advocacy data never enters as evidence.
- Vintage discipline: every row carries `vintage_date`; verdicts note "as measured at publication" — recorded provenance, not an ongoing re-verification commitment (CROSS-CUTTING §10).
- Claims citing sources outside the map → open-web loop + explicit no-pre-vetted-authority note.

## 4. Tests

Every risk maps to a layer in `TEST-STRATEGY.md`: **L1** every push, **L2** every PR, **L3** weekly and pre-release, **L4a** every push, **L4b** pre-release.

The deterministic surface is large and cheap; the LLM surface is gated by golden snapshots and the harness. Highlights:

| ID | Risk | Consequence if untested | Test | Signal | Layer |
|---|---|---|---|---|---|
| VER-R1 | Grid arithmetic errors — wrong denominator, stale vintage, wrong baseline | Confidently wrong arithmetic in the flagship mode | **Stat-grid arithmetic is pure logic — exhaustive L1 coverage.** Fixture series with pinned vintages per domain; golden expected grid per fixture (every axis × every outcome); vintage-selection failure cases; independent SQL recomputation cross-check | L1 exhaustive fixture grids; vintage ≠ retrieved_at assertion; SQL recomputation cross-check | L1 |
| VER-R2 | NLI audit false-passes | The accuracy gate is theatre; hallucinations publish | Must-pass/must-fail packs (unattributed synthesis, unstated arithmetic, authority-by-citation, hallucinated sentence); audit agreement measured at L3; failure-rate alert | Must-pass/must-fail packs at L1; audit-vs-human agreement at L3; implausibly-zero failure rate | L1 + L3 |
| VER-R3 | Retrieval failure/quality (the AVeriTeC bottleneck) | The least-reliable mode silently sets the accuracy ceiling | AVeriTeC as the generic-loop gate from week 1; open-web stratum gated; retrieval telemetry trended; retrieval-failure fixtures assert capped-degraded, never silent weak verdicts | L3 open-web stratum; EV2R trend; depth-cap-binding rate; AVeriTeC position | L1 + L3 |
| VER-R4 | Citation comparison errors — extraction misses number/period/population, or over-binds decorative citations | False Supported/Refuted against sources that don't say what was extracted | Fixture corpus: exact match, number/period/population mismatch, decorative citation, paywalled — each asserts verdict class + binding strictness | L1 claim/source pair fixtures (match, mismatches, decorative, paywalled); L3 citation stratum | L1 + L3 |
| VER-R5 | Quote fidelity mis-reads ASR artefacts as quote errors (or passes misquotes) | Verdicts assert wording differences that are caption artefacts | Caption-artefact fixtures (homophones, punctuation, number formats, te reo) with expected treatments; anchor construction tests; L3 quote stratum | L1 caption-artefact fixtures; L3 quote stratum | L1 + L3 |
| VER-R6 | Provenance mode over-trusted | Slice overclaims the least mature mode on live material | Provenance mode runs only on fixture-gated records; methodology page asserts the demonstration-only posture | Fixture-gate assertions; methodology posture text asserted at L4 | L1 + L4a |
| VER-R7 | Prompt/model drift between runs | Every accuracy delta arguable; numbers unreproducible | Golden set (~20 claims, all modes, pinned versions) per PR — visible diff; manifest completeness at L1 | L2 golden diff per PR; manifest completeness; residual-nondeterminism probe | L2 (+L1) |
| VER-R8 | Cost blowout toward naive $10+/claim | Cost deliverable fails; weekly runs unaffordable, gate goes stale | Depth-cap bounds tests; pre-run cost projection blocks over-budget runs; cost/claim per stratum per run | Cost/claim vs $25 envelope; depth-cap-binding rate; anomaly alert | L1 + L3 |
| VER-R9 | Evidence-fetch failures degrade verdicts silently | Verdicts publish on weaker grounding, no visible flag; contestation exposes it | Fetch-failure fixtures assert flagged degradation (no silent fallback); pack schema forbids unflagged missing items | Pack schema: resolved or flagged-degraded; degraded-grounds metric; L4 rendering | L1 + L4a |
| VER-R10 | Materiality-selection drift — wrong grid rows foregrounded | Cherry-picking missed, or omissions asserted where unsupported | Golden fixtures carry hand-labelled material-row expectations; L3 cherry-picking oversample (≥12 labels) is the measured check | L2 golden fixtures with hand-labelled material rows; L3 cherry-picking oversample | L2 + L3 |
| VER-R11 | Verdict-class boundary errors — true-but-selective labelled Refuted, or selective framing as Supported | Flagship class mis-fires both directions; calibration breaks | Boundary fixtures (selective → Conflicting; no-row-match → Refuted; thin → NEI); L3 verdict-mix vs targets catches over-refutation | L3 verdict-mix vs targets + calibration; L1 boundary fixtures | L1 + L3 |
| VER-R12 | Confidence miscalibration | Open-question posture hollows out; abstention unmeasured | Threshold fixtures (below-threshold → open question); L3 calibration table per run | L3 calibration table; threshold fixtures; L4 open-question rendering | L1 + L3 |
| VER-R13 | Fingerprint misread at verification time | Grid computed on the wrong window — verdict answers a question nobody asked | Fingerprint→grid-parameter round-trip fixtures; L2 claims span endpoint/unit edge cases | Fingerprint→grid-parameter round-trip fixtures; L2 edge-case claims | L1 + L2 |
| VER-R14 | Authority-map misuse — wrong tier's series, or advocacy data as evidence | Verification bias; ADR-0018 guardrail broken in code | Authority resolution per seeded domain; advocacy-source rejection asserted | Authority-resolution tests per domain; A6 rejection asserted | L1 |
| VER-R16 | Verdict class moves between runs of identical input — no usable sampling knob to pin it | A published class flips on a re-check with nothing in the way, and the verdict reads as a finding rather than a draw | Agreement gate unit-tested both directions (agree → first outcome; disagree → no outcome, both classes carried; a thrown call propagates rather than counting as disagreement); disagreement rate reported per L3 run | Class-agreement gate before publication; disagreement publishes nothing, is counted, and is reported as instability | L1 + L3 |
| VER-R15 | Routing misclassification | Claims land in the least reliable mode by accident; failures attributed to wrong machinery | Router fixtures over type × text patterns; routing decision stored for L3 cross-tabbing | Router fixtures; L3 lane×mode cross-tab | L1 + L3 |
| Behavioural | — | — | ≥1 pinned claim per mode in the golden set |  | L2 |
| Deliverable | — | — | Per-stratum accuracy + calibration + cost/claim table; gate per HARNESS §2.6 |  | L3 |
| Site | — | — | "As deployed", alternatives table, hear-it anchors, degraded-evidence flags, generated methodology table |  | L4 |

**L1 fixture set**: fixture series with pinned vintages; golden expected grids; class-boundary claims; cited-document corpus; caption-artefact fixtures; authority-map resolutions; fetch-failure modes; NLI must-pass/must-fail packs; routing fixtures; depth-cap bounds. All LLM calls mocked.

## 5. Open questions

| # | Question | Notes |
|---|---|---|
| 1 | ~~Search-provider order~~ **Resolved**: Brave primary, Serper fallback/bulk (ADR-0011 governs; confirmed 10 Sep 2026). Per-query nuance (authority-restricted → Brave, bulk → Serper) is `search_config` | — |
| 2 | Materiality-selection rubric sign-off — what artefact, who signs off, does the signed rubric join `grid_axes_version` (forcing an L3 re-run on change)? | The anti-invented-standard defence depends on this being pre-declared and auditable |
| 3 | Quote-fidelity tolerance policy — what delta flips the verdict vs triggers the caption-quality note? Needs a listen-test policy, not a guessed threshold | Conditions VER-R5 fixture expectations |
| 4 | Provenance-mode graduation criteria — what measured result justifies live false-context handling, and who decides? | Pairs with HARNESS Q7 |
| 5 | NLI-auditor calibration bar — what false-pass rate disqualifies the auditor model? | Deferred until two L3 runs produce audit-agreement data |
| 6 | Depth-cap values per mode — the FIRE pattern fixes the mechanism, not our numbers; calibrate against first L3 cost data | The $25/run envelope bounds the search space |
| 7 | Stat-mode verdict for misquoted-but-real numbers (right indicator, wrong figure) — the no-row-match rule says Refuted; confirm the boundary holds for rounding variants ("about 30%" vs 27.3%) or whether a tolerance band is needed | Interacts with VER-R11 fixtures |
| 8 | **Causal claims have no mode** (VERIFICATION §2.1). 11% of the corpus is causal; timing evidence is currently reported under the open-web bound. Needs either a sixth mode (pre-trend tests, unaffected comparison group, difference-in-differences) or an explicit out-of-scope refusal — the one option ruled out is grading a causal claim with a check that cannot reach causation | Publishes a bound on every mode's trail section meanwhile; the gap is named on the page and on `/methodology`, not assumed covered |