# Verification engine design

*ADRs: 0001, 0004, 0005, 0008, 0011, 0018, 0020, 0021, 0026. Companions: `ARCHITECTURE.md`,
`VALIDATION-SLICE.md`, `TEST-STRATEGY.md`, `CROSS-CUTTING.md`.*

## 1. Purpose and slice scope

The verification engine turns a triaged claim into a verdict, an evidence pack, and an audit result, and
appends them to the store (ADR-0005, ADR-0026). It does this with **one instrument**: a capped
adversarial research loop of three roles.

| Role | Input | Output |
|---|---|---|
| `claim-assessor` | the claim, its context, and (from turn 2) the previous critique | an evidence plan: what would prove or disprove the claim, and the questions to answer |
| `researcher` | the plan and the evidence so far | a bounded tool-loop agent: it plans queries, runs them in parallel, reads pages, extracts passages and decides the next step |
| `evidence-critiquer` | the claim, the plan, and **all** evidence across turns | sufficiency: is the evidence enough to settle it; the verdict class, confidence, reason, gaps and justifications |

The assessor is adversarial by construction: it is asked what would **falsify** as well as confirm, and
its plan names the questions that would disprove the claim. It does not write search queries; the
researcher chooses those, and its prompt requires at least one search aimed at refuting the claim
(ADR-0020 rule 3). Retrieval is still the bottleneck — gold evidence lifts accuracy by 14 to 22 points —
so the researcher works a bounded tool loop rather than one search.

**One instrument, and what it costs.** Verification is this loop and nothing else: there is no
per-claim plan, no separate entailment gate, and no per-claim-type check. The claim-anchored evidence
store, the A1–A6 authority map, source admissibility and corroboration remain and are applied by the
critiquer. **The loss is real and named:** a quantitative claim is researched like any other rather
than computed against a pre-declared grid, and the page says so. A deterministic series check can
return as an evidence *source* for the researcher (OPEN-QUESTIONS).

## 2. Design

### 2.1 The loop

```
claim + context
   → claim-assessor → plan { evidencePlan, questions }
   → researcher (tool loop) → evidence + strategy + queries + tool calls
   → evidence-critiquer
        ├─ sufficient                  → finding (class + reason + justifications)
        └─ insufficient, budget left    → back to claim-assessor with the critique
        └─ insufficient, budget spent   → not_enough_evidence, with the critiquer's reason
```

**The loop runs against a USD research budget, not a turn count** (`DEFAULT_RESEARCH_BUDGET_USD`, 0.25,
overridable with `RESEARCH_BUDGET_USD`). Spend is priced from the versioned price map (ADR-0012) and
checked between turns, so a claim that settles early stops early and a hard claim gets more looking.
`MAX_RESEARCH_TURNS` (20) is a hard backstop for a run that cannot read its own spend, not the policy;
`MAX_SEARCHES_PER_TURN` and `MAX_RESEARCH_STEPS_PER_TURN` still bound each researcher turn. A stopped run
is a **finding about the record**, named as one: the conclusion is `not_enough_evidence`, the critiquer's
stated reason is published, and `stopReason` records which bound bit.

The loop record is stored on the evidence pack (`evidence_pack.research`): each turn's plan, strategy,
queries, tool calls and critique, the evidence found, the turns used, the budget and spend, why the loop
stopped, and the
class-agreement state. The verdict page renders the plan, the searches and tool calls the researcher
made, the evidence found, and the critiquer's finding.

### 2.2 The researcher is a tool-loop agent

The researcher runs on the AI SDK's `generateText` with tools, behind a typed `AgentPort` so the blind
rule holds and L1 can mock the model. Its tools are the action space:

| Tool | What it does |
|---|---|
| `search` | a web search; several may run in parallel in one step |
| `readPage` | fetch the full text of a page |
| `extractEvidence` | for a set of urls and a question, return the shortest **verbatim** passages that speak to the claim |
| `finish` | no execute — calling it ends the loop |

The assessor's plan names where the evidence would live — for a New Zealand data claim, the primary
agency (`stats.govt.nz`, `policedata.nz`, the Ministry of Justice NZCVS) and figure.nz, which curates
official NZ series and links each to its source — and the researcher targets those domains rather than
the claim's wording. The loop is bounded by `stopWhen: [stepCountIs(maxSteps), hasToolCall('finish')]`,
and each tool enforces a budget (searches, reads), telling the model when a budget is spent so it can
finish. Every tool call is
recorded from the SDK's per-step results, so the run's actions are auditable and the public trail can
show exactly what the researcher did.

### 2.3 The critiquer is the publication gate

The critiquer decides sufficiency. Its finding must cite evidence for **every** justification; a
conclusion the evidence does not support is a failed call, not an implicit pass. This replaces the NLI
audit (ADR-0005 §2.7): the entailment question is asked where the class is chosen, so a claim whose
evidence does not support its class cannot publish. The critiquer also states the loop's own bound —
what the evidence cannot establish — in plain words.

The critiquer is itself a model, so it is calibrated by the harness: must-conclude / must-not-conclude
packs at L1, and critiquer-vs-human agreement on labels at L3.

### 2.4 Verdict classes

`supported` · `refuted` · `not_enough_evidence` · `conflicting_cherry_picking` (ADR-0004). `pledge` /
`conditional` are store statuses for held commitments, not classes the loop returns.

**Class-agreement gate (VER-R16).** The class-deciding call runs **twice** and only an
agreed class is published; a disagreement publishes `not_enough_evidence` and is counted. This exists
because the configured models discard the sampling settings, so identical input moved a class between
runs. A failed call is not a disagreement: provider errors propagate.

### 2.5 Source admissibility, authority and corroboration (ADR-0020)

The critiquer applies the published criteria; they are not owned by any role:

- **Some sources can never be the record** (`admissibility.ts`): encyclopaedia pages, social posts,
  aggregators, self-publishing platforms. A low grade is not an exclusion; these are.
- **The authority floor for a decisive verdict** is tier 5 or better. Below the floor, or on an
  inadmissible source, the honest class is `not_enough_evidence`.
- **Corroboration**: one official record for the claim's own jurisdiction, or at least two independent
  sources from different domains. Media commentary about related facts is not enough.
- **Refutation**: at least one search aimed at refuting the claim. A search that only confirms is not
  verification.
- **Authority map** (A1 > A2 > … > A6): the conflict is often the finding. Advocacy data is at best A6,
  never a verdict basis (ADR-0018). The authority registry (`authority` table) accumulates discovered
  authorities from claim traffic.

### 2.6 Shared spine

| Element | Behaviour |
|---|---|
| Context pack | claim + `supports` + topic + venue + document text + jurisdiction (ADR-0008, ADR-0021, ADR-0026). Claimant identity never enters. |
| Question decomposition | the assessor decomposes the argument where one exists, conditioned on the context |
| Refusals are refusals | a bot-protection or interstitial page (which arrives with a 200 and text) is treated as a failed fetch, never extracted as evidence; a host that can never be the record (ADR-0020) is refused before it becomes evidence |
| Bounded calls | every model call and search carries a wall-clock timeout, so a stalled provider degrades to a recorded failure instead of holding the run open |
| Bounded depth | a USD research budget (the policy) plus per-turn caps on searches and steps, with a hard turn backstop; the budget, spend and stop reason are stored on the pack (a stopped run is visible, not silent) |
| Extraction-ladder fallback logging | every evidence fetch runs the ladder; Tier-2 events land in `fallback_log` per lane |
| Evidence-pack assembly | items with vintage + archive snapshot, the loop record, justifications; append-only, pinned by the verdict version |
| Abstention | below-threshold or budget-stopped claims publish as open questions (ADR-0001/0004) — a measured capability, not a failure |

### 2.7 Model tiers (ADR-0011 provisional routing)

The routing table is tiered by *what the output is used for*, not by how hard the task looks:

- **Verdict tier** (`claim-assessor`, `evidence-critiquer`) — the plan and the sufficiency decision are
  what a reader sees, so they stay on the strong model. `evidence-critiquer` is the publication gate
  and is deliberately **not** the cheap tier.
- **Research tier** (`researcher`, `researcher-extract`, `authority-classify`) — the tool loop, the
  passage extractor and source classification, the bulk of the calls per claim; their output is
  evidence the critiquer judges rather than a published finding. A weaker model here costs rounds and
  searches, bounded by the caps, and degrades to *not enough evidence* — an honest abstention rather
  than a fabricated verdict.
- **Decision transport (ADR-0024).** Classification-shaped roles may run on a System One decision model
  instead of a generative one, settling confident answers and escalating the rest. `triage-checkability`
  is routed (threshold 0.70, measured at 96.0% on the settled subset); `triage-speakership` is not,
  because the same measurement puts it at 55.7% accuracy. The routing default is overridable with
  `DECISION_ROLES`; `ops/calibrate-decisions.ts` re-measures it against the labelled set.

### 2.8 Search APIs (ADR-0011)

- **Brave primary** (Goggles map onto A1–A6 authority restriction), **Serper fallback/bulk**. Which is
  primary is routing config, not code.
- Query-level control is the requirement: evidence-pack reproducibility needs it.
- Every call token/latency-telemetered via gen_ai spans (cost applied at aggregation from the price map
  — CROSS-CUTTING §5.3); queries + result URLs recorded on the pack so the retrieval path is auditable
  and re-runnable.

## 3. Interfaces

### 3.1 Inputs from triage

| Field | Contract |
|---|---|
| claim record | text, `speakership_class`, discourse context, FKs (no type, no mode — ADR-0025/0026) |
| discourse context | `window` (verbatim) + `supports`, `policyTopic`, `speechContext`, `contextQualifiers` — all nullable, never defaulted |
| media fields | `media_anchor`, `transcript_tier`, `caption_quality_flag`, cue span |
| explicitly absent | claimant identity as a decision input, reliability profile (firewall), label data (blind rule) |

### 3.2 Outputs to the store

| Object | Contract |
|---|---|
| `verdict_version` (v1) | four classes + pledge/conditional, confidence, status; below-threshold → open questions |
| `evidence_pack` | items + justifications + the research-loop record; append-only, pinned by the verdict version |
| `evidence_item` | authority ref, source identity, `vintage_date`, URL, `archive_snapshot_url`, hash, version — one row per fetched version |
| `verdict_provenance` | pipeline/prompt/model versions, search refs, token/latency spans — rendered as the site's provenance block |
| `fallback_log` | per-lane Tier-2 events |
| open-question record | below-threshold claims with the pack attached, inviting contest |

## 4. Tests

| ID | Risk | Consequence if untested | Test | Signal | Layer |
|---|---|---|---|---|---|
| VER-R1 | *(retired)* Grid arithmetic. The grid is removed (ADR-0026) | — | — | — | — |
| VER-R2 | The critiquer false-passes — hallucinated or unsupported findings publish | The accuracy gate is theatre | Must-conclude / must-not-conclude packs at L1; critiquer-vs-human agreement at L3; failure-rate alert | Must-pass/must-fail packs; agreement at L3 | L1 + L3 |
| VER-R3 | Retrieval failure/quality (the bottleneck) | The loop silently sets the accuracy ceiling | AVeriTeC as the generic-loop gate; retrieval telemetry; capped-degraded fixtures | L3 stratum; depth-cap-binding rate | L1 + L3 |
| VER-R4 | *(retired)* Citation comparison | — | — | — | — |
| VER-R5 | *(retired)* Quote fidelity | — | — | — | — |
| VER-R6 | *(retired)* Context procedure | — | — | — | — |
| VER-R7 | Prompt/model drift between runs | Every accuracy delta arguable | Golden set per PR with pinned versions — visible diff; manifest completeness at L1 | L2 golden diff; manifest completeness | L2 (+L1) |
| VER-R8 | Cost blowout | Weekly runs unaffordable, gate goes stale | Turn/search/tool-step cap bounds tests; pre-run cost projection; cost/claim per stratum | Cost/claim vs envelope; cap-binding rate | L1 + L3 |
| VER-R9 | Evidence-fetch failures degrade verdicts silently | Verdicts publish on weaker grounding, no flag | Fetch-failure fixtures assert flagged degradation | Pack schema: resolved or flagged-degraded | L1 + L4a |
| VER-R10 | *(retired)* Materiality-selection drift | — | — | — | — |
| VER-R11 | *(retired)* Grid verdict boundary | — | — | — | — |
| VER-R12 | Confidence miscalibration | Open-question posture hollows out | Threshold fixtures; L3 calibration table per run | L3 calibration table | L1 + L3 |
| VER-R13 | *(retired)* Fingerprint misread | — | — | — | — |
| VER-R14 | Authority-map misuse — wrong tier's series, or advocacy data as evidence | Verification bias; ADR-0018 guardrail broken | Authority resolution per domain; advocacy rejection asserted | L1 | L1 |
| VER-R15 | *(retired)* Plan misclassification. There is no plan | — | — | — | — |
| VER-R16 | Verdict class moves between runs of identical input | A published class flips on a re-check | Agreement gate unit-tested both directions; disagreement publishes nothing and is counted | Class-agreement gate; disagreement rate per L3 run | L1 + L3 |
| VER-R17 | **A stopped loop silently truncates a real finding** | A stopped run reads as "no evidence" rather than "we stopped" | Stopped-run fixtures assert `not_enough_evidence` + the critiquer's reason + `stopReason`; budget-exhaustion rate reported | Budget-exhaustion rate; reason present on stopped runs | L1 + L3 |
| Behavioural | — | — | ≥1 pinned claim per verdict class in the golden set |  | L2/L3 |
| Deliverable | — | — | Per-stratum accuracy + calibration + cost/claim table; gate per HARNESS §2.6 |  | L3 |
| Site | — | — | research plan/trail rendering, degraded-evidence flags, generated methodology table |  | L4 |

**L1 fixture list**: authority-map resolutions; fetch-failure modes; critiquer must-pass/must-fail packs;
loop control (sufficient / loop-back / cap / disagreement); researcher budget bounds. All LLM calls
mocked.

## 5. Open questions

| # | Question | Notes |
|---|---|---|
| 1 | ~~Search-provider order~~ **Resolved**: Brave primary, Serper fallback/bulk (ADR-0011). | — |
| 2 | **Reintroducing a deterministic series check** — a quantitative claim is researched like any other today (ADR-0026). Add it as an evidence source for the researcher, not as a procedure, so the plan stays a single loop | Tracked; the capability loss is named in ADR-0026's consequences |
| 3 | Critiquer calibration bar — what false-pass rate disqualifies the critiquer model? | Deferred until two L3 runs produce agreement data |
| 4 | Turn/search/tool-step cap values — calibrate against first L3 cost data | The $25/run envelope bounds the search space |
| 5 | Causation — no check tests it; the loop reports timing evidence and says so on the page | Publish a bound on every trail section; named on `/methodology` |
| 6 | Rounding tolerance for a "misquoted but real" number — confirm the boundary between `refuted` and `conflicting_cherry_picking` | Interacts with VER-R16 fixtures |
