# Claim detection & triage design

*ADRs: 0004, 0005, 0008, 0010, 0014, 0019. Companions: `ARCHITECTURE.md`, `VALIDATION-SLICE.md`, `TEST-STRATEGY.md`, `CROSS-CUTTING.md`.*

## 1. Purpose and slice scope

Triage turns document records (INGESTION §3.1) into **claim records**, and decides what does *not*
become a claim. It does five things:

1. **Checkability.** For each sentence, an LLM decides whether it is a checkable claim.
2. **Typing.** It assigns a type — statistical, citation-backed, broadcast-quote, institution-citation,
   false-context, or other — and the type selects the verification mode.
3. **Fingerprint.** It extracts the six-part key (indicator, population, geography, time window,
   baseline, unit) used for dedup, evidence-store matching, and idempotency.
4. **Context extraction.** It fills the optional context fields over the stored window. These select
   the **material** rows of the stat grid, so an error here reaches the verdict.
5. **References and drops.** It links the claim to its publication and segment rather than copying the
   hierarchy, and it logs every rejected sentence with its window and reason. Recall is **measured,
   not assumed** (§2.5).

Triage runs on every ingested document. The false-context set skips checkability (its items are
pre-typed) but still exercises typing and context extraction. Triage never verifies, never writes a
verdict, and never uses a claimant's identity to decide anything (ADR-0002).

**Eligibility and reading are different things.** "Never uses a claimant's identity to decide
anything" governs how a claim is *read*, not which sentences arrive. **Eligibility** — whether a
sentence is ours to check at all — is decided upstream at ingestion, by speakership attribution
(INGESTION §2.9). It reaches triage as a flag: outlet narration and unresolvable attribution are
already excluded, and a quoted actor arrives as an attribution candidate rather than a person to
reason about. **Reading** — checkability, typing, context — then runs with the claimant
playing no part. Identity decides *whether* a sentence is checked; it never decides *what the check
finds* (ADR-0008, ADR-0019).

## 2. Design

### 2.1 Stage shape

```
[document record + attribution candidates + dedupe inputs]
  → sentence split (deterministic; cue-span-preserving for captions)
  → per-sentence LLM triage: checkable? (+ claim type + mode, one call)
       ├─ no  → drop-log record (retained, evaluable)
       └─ yes → context extraction → claim record → verification queue + store
```

**What the orchestrator actually calls.** The diagram above is the contract. The implementation
differs, and the difference is worth stating: document triage makes `triage-checkability` calls (one
per chunk, each returning `claimType` per sentence) and one `triage-context` call per checkable claim
that has a window. It does **not** call `triage-typing` — typing is folded into the checkability call.

**The fingerprint step was removed outright (ADR-0023).** It extracted a six-part identity object
before any evidence was fetched; the figures procedure then read its window and magnitude out of two
free-text fields by regex, and a failed parse degraded the claim's *type* to `other`, silently
rerouting it to a different check. Nothing read the identity key it also produced. The claim's window
and magnitude are now parsed at the point of use, inside the procedure that needs them, as a typed
step (`claim-parameters.ts`), and an unreadable magnitude abstains rather than rerouting. `mode` is
gone from `TypedClaim` too: a claim's procedures are the plan's (`plan.ts`, ADR-0023).

That drift went unnoticed for weeks because every stage had its own passing tests and nothing checked
the *call set*. `contextFromLlm` was covered by its TRI-R5/TRI-R6 tests but called by nothing, so
`attached_proposal` was null on every real claim and the verdict page's "as deployed" line — a
required section — could not render. A test in `triage.test.ts` now pins the roles triage calls and
fails if a stage stops being called; it also pins the role that is not called, so wiring typing is a
decision rather than an accident. Open question 2 is now only about typing.

Model routing (ADR-0011): triage and typing are the high-volume structured-extraction
role (Flash-class, batch-priced, harness-gated); the context pass is separate and short-circuits
cleanly. Sampling settings live on the shared config surface (`SAMPLING`, CROSS-CUTTING §2) and are
passed on every call — **but they are advisory, and on the configured models they are discarded.**
The SDK warns that `claude-sonnet-5` ignores `temperature` and that the OpenRouter model ignores
`seed`, so the pin does not fix the 31-versus-42 claim flap that motivated it. Determinism needs a
mechanism that survives a model with no seed: agreement across repeats, a seed-honouring model for
the variance-critical roles, or measuring and disclosing the variance. Open question 9.

### 2.2 Checkability

This runs per sentence. The window can support a claim but never turns a non-claim into a checkable
one. **Eligibility is already settled** by now: speakership attribution (INGESTION §2.9) has excluded
outlet narration and unresolvable attribution upstream, so triage is never asked whether a statement
is *ours to check* — only whether it is checkable. The classes are: checkable; not-checkable
(opinion, rhetoric, procedure, satire — satire is triaged *out*, never "checked"); and
pledge-conditional ("pledge — not yet checkable", checkable only as a consistency claim). Output is
the decision plus the evidence behind it: the sentence, its window span, and the rejection class. The
prompt is a versioned artefact.

**Call bound (TRI-R12, Sept 2026).** The call returns one result per sentence, so its response grows with the document while the adapter's output budget is fixed — an unbounded request is a truncation waiting for the first long article. The document is therefore split into chunks of at most **20 sentences or 6000 characters** (whichever binds first), and a chunk whose response fails schema validation is retried at **half size** before the document is failed. A document that fits in one chunk still makes exactly one call with the unchanged payload. Consequences worth stating:

- `triage_record.sentences_read` counts the whole document across chunks, so a partially-read document can never publish as a fully-read one: a chunk that still fails after halving aborts the run rather than shrinking the denominator silently.
- Token counts are summed across chunks; the run's provenance records **one** model, so chunks that disagree (an ADR-0011 escalation mid-document) fail loudly instead of recording the first chunk's model for all of them.
- Truncation is named where it happens: the adapter surfaces `finish_reason`, so a cut response reads as `finish_reason: length` rather than "the model did not return a response".

### 2.3 Claim typing

Triage answers **what kind of claim this is**. It does not decide which check the claim gets: that is the
**plan** (ADR-0023, `VERIFICATION.md` §2.1), built from the claim's features and the procedure library.
The type still matters, because a type is what makes a required procedure *required* — a quantified
assertion is why the figures procedure must be decided on.

| Type | Signal | What the type makes required |
|---|---|---|
| `statistical` | quantified assertion | the figures procedure |
| `citation-backed` | explicit citation of a retrievable document | the document procedure |
| `broadcast-quote` | caption-derived claim whose wording matters | the recording procedure |
| `institution-citation` | institution claim paired with own evidence | the document procedure (institution stratum, R6) |
| `false-context` | `is_curated_fixture` item, or decontextualisation signal | the context procedure (curated set only) |
| `other` | default | nothing required; the research procedure is the floor |

At the boundary we are conservative: a statistical signal whose magnitude cannot be parsed abstains
rather than degrading to `other`. Rerouting a claim to a different check because its *parse* failed
was the old behaviour (TRI-R3) and it hid the failure in the claim's type; the parse now fails inside
the procedure, where an abstention is the honest reading of "we could not tell what number this is".

### 2.4 Fingerprint and dedup

- **Fingerprint — removed (ADR-0023).** The six-part key was extracted at triage time, and two of its
  fields were the only thing anything consumed: the figures procedure read the window out of
  `temporal` with `/(?:since|from)\s+(\d{4})/i` and the magnitude out of `quantity` with "the first
  number in the string". Neither format was declared anywhere, so a claim parsed as `2017-2026`
  produced an abstention and a magnitude stated as "a third" was indistinguishable from no magnitude
  at all. The key itself had no reader. The window and magnitude are now typed and parsed at the point
  of use (`claim-parameters.ts`). A pgvector embedding over the claim text still catches near matches.
- **Repeats.** An embedding match adds a **source-occurrence**, never a new queue entry. (A fingerprint
  match did the same until ADR-0023 removed the fingerprint.)
  Occurrences carry their publication and segment references.
- **Idempotency.** Re-running triage on the same document resolves to the same claim records.
  Fingerprint normalisation is versioned config, so changing it is a pipeline change that re-runs the
  harness.
- **No merging on near matches.** A near match with a different claimant, window, or context is
  flagged for review, not merged. With the fingerprint gone, the embedding is the whole near-match
  mechanism, which is the part that was doing the work anyway.

### 2.5 Drop logging (recall is measured, not assumed)

Every dropped sentence writes a drop-log record: references, span, verbatim text, window, rejection
class, and the provenance tuple. Those records are inputs to the harness, not a by-product.

- **Drop-rate telemetry.** `triaged (checkable / dropped)` per lane; a shift is the
  claim-detection-drift tripwire.
- **Recall measurement.** The L3 harness labels a sample of the drop log — "should this have been a
  claim?" — so triage recall is a reported number. Without it, under-detection is invisible: what was
  never detected never enters the labelled-claim sample.
- **Re-triage.** Dropped sentences are kept with their provenance, so a prompt change can re-triage
  past drops and measure the difference.

### 2.6 What triage never does

Triage never assigns a verdict or a confidence — that is adjudication's contract (ADR-0004). It never
resolves attribution (ADR-0002). It never infers `attached_proposal` from speaker identity, party, or
history; window text only (ADR-0008). And it never treats Tier-2 caption wording as reviewed text:
caption claims inherit `transcript_tier` and the "claim pointer, never evidence for a number" rule
(ADR-0007).

## 3. Interfaces

### 3.1 Claim record (Drizzle-typed, Zod-validated at the LLM boundary)

| Field | Meaning |
|---|---|
| `claim_id` | store key; stable under reprocessing |
| `publication_id` / `segment_id?` | ADR-0008 FKs |
| `sentence_span` / `utterance_text` | verbatim source span — the quotable artefact, never paraphrased into verdicts |
| `text` | normalised standalone claim (the utterance and window remain the auditable originals) |
| `claim_type` | enum (§2.3) |
| `embedding_ref` | repeat/adjacency matching |
| `discourse_context` | the ADR-0008 field set (§3.2) |
| `media_anchor?` / `transcript_tier?` / `caption_quality_flag?` | caption-sourced claims |
| `attribution_candidates` | pass-through, unresolved |
| `is_curated_fixture?` | false-context gate |
| `source_occurrences[]` | repeat provenance |
| `pipeline_version` / `prompt_versions` / `model_version` | provenance tuple |

### 3.2 Discourse-context fields (all optional; extracted-if-present, never assumed)

| Field | Source | Verification consequence |
|---|---|---|
| `speech_context` | publication record (deterministic) | venue/occasion metadata |
| `policy_topic` | LLM pass over window | question seeds; topic facets |
| `attached_proposal` | window text only | **selects material grid rows**; renders the "as deployed" line |
| `argument_direction` | stance over window; null when not confident | problem-vs-success framing |
| `context_qualifiers` | speaker's own qualifications | false-alarm protection ("up from a low base") |
| `window` | verbatim span, deterministic | the auditable artefact; quoted, never paraphrased |

A claim with all-null context still verifies (no hard gate — the page shows no "as deployed" line); every field is published and contestable.

**Two names for one thing.** The fields above are triage's *extraction* shape. The **stored** shape
(`StoredDiscourseContext` in `@cw/store`) uses different names for some of them, and nothing mapped
between the two — which is why the context pass was never wired into an orchestrated run.
`toStoredDiscourseContext()` in `packages/pipeline/src/triage.ts` is now that boundary, and it
carries `window` through verbatim. `argument_direction` was specified here from the start and
extracted by nothing, so its column could only ever be null; the extraction schema and prompt ask for
it as of `triage-context@2`.

A claim whose sentence has **no window** gets no context call and an all-null context, because the rule above is window text only: a missing window means absent, never "read it off the claim".

### 3.3 Handoffs

- **To verification**: claim record + type, from which the plan is built (ADR-0023); the default context pack attaches automatically (ADR-0008).
- **To the store.** Writes are append-idempotent on the claim's content identity
  (`claim.claim_key`, unique on sentence text plus window plus type, i.e. `TypedClaim.claimId`);
  occurrences append. It is **not** the removed fingerprint — that existed only for statistical
  claims, so it could not dedupe a quotation or a cited-document claim, and the stage never ran
  (open question 2). The key means a re-ingest that reaches the same conclusion about the same
  sentence finds the claim it already made. It cannot withdraw a claim a later run would not make:
  the graph grows with the union across runs, because a published claim is not retractable.
- **To harness**: exports in AVeriTeC-aligned shape via the shared Drizzle/Zod definitions; harness and store schema versions must match.
- **Drop-log**: pipeline-owned (blind rule doesn't apply to it); its *labels* live on the harness side.

## 4. Tests

Every risk maps to a layer in `TEST-STRATEGY.md`: **L1** every push, **L2** every PR, **L3** weekly and pre-release, **L4a** every push, **L4b** pre-release.

Highlights:

| ID | Risk | Consequence if untested | Test | Signal | Layer |
|---|---|---|---|---|---|
| TRI-R1 | Over-detection: opinions/rhetoric/satire/pledges promoted to claims | Verification spend on uncheckable text; satire "checked" | Checkability fixtures: opinion/rhetoric/satire/pledge must NOT become claims; genuine claims must | Labelled precision sample; pledge/satire fixtures | L1 + L3 |
| TRI-R2 | Under-detection: checkable claims dropped silently | Highest-harm classes missing while the funnel looks healthy | Drop-log recall sample scored at each L3 run; drop-rate alert wired | Drop-log recall sample; drop-rate shift alert | L3 + monitor |
| TRI-R3 | **Wrong typing — the highest-consequence triage failure** | A statistical claim typed `other` never makes the figures procedure required, so the flagship verdict becomes unreachable without anything looking wrong | Typing-conformance fixtures per type assert the mode entered; per-type accuracy is an L3 deliverable | Per-type routing accuracy; type-vs-verdict-path check | L1 + L2 + L3 |
| TRI-R4 | Claim-key collisions/misses break dedup | Corrupted claim graph; double spend or swallowed repeats | Dedupe pairs: identical merge; near-duplicate no-merge; adjacent-window occurrence; macron/number-format round-trips | Fingerprint fixture pairs; double-run idempotency | L1 |
| TRI-R5 | Context-extraction errors silently change grid-row selection | "As deployed" asserts a framing the speaker didn't deploy | Grid-materiality integration: context variants → asserted material-row differences; L3 context ablation | Context labels in L3; with/without-context ablation | L1 + L3 |
| TRI-R6 | Context over-inference from speaker identity/party | ADR-0008's no-inference guardrail broken; partisan fabrications | Identity-only windows → asserted null `attached_proposal` | Fixture: identity-only signals → null fields | L1 |
| TRI-R7 | Normalised text drifts from utterance (omission-of-context failure) | Pipeline verifies a claim the speaker didn't quite make | Utterance/window/text persistence asserted; normalisation derivable from utterance + window | Verbatim-vs-normalised fixture pairs | L1 + L2 |
| TRI-R8 | Verdict-class misalignment — records that can't reach the four classes (pledges typed as generic) | Harness scoring misaligned to the benchmark universe | Every claim validates against the shared export schema; pledge fixtures typed conditional | Schema assertion: fields per target verdict class; pledge fixtures | L1 |
| TRI-R9 | Drop log exists but is never sampled — recall assumed | Triage quality asserted, never measured | L3 run without a scored drop-log sample fails preflight | Run-manifest asserts a drop-log sample scored | L1 + L3 |
| TRI-R10 | Model/provider drift changes triage behaviour | Outputs shift after silent upgrades; verdict mix changes unexamined | Golden snapshots per PR with pinned versions | L2 golden snapshots; version pinning | L1 + L2 + L3 |
| TRI-R11 | Tier-2 caption wording treated as reviewed | ASR errors define unmade claims (ADR-0007's worst failure) | ASR-derived claims must carry tier/quality flags — missing flags fail schema validation | Tier/flag propagation assertions | L1 |
| TRI-R12 | `generateObject` schema failures silently drop outputs | Claims lost mid-pipeline, no funnel signal | Malformed LLM outputs → failure-class record + counter, never a silent skip | Zod failure counters; drop-rate-vs-schema-failure alert | L1 |
| TRI-R13 | Re-triage idempotency failure — same document re-triaged yields a different claim set | Duplicate claims, orphaned verdicts | Double-run invariance: identical claim IDs/counts; re-triage appends versions | Double-run invariance test | L1 + L2 |
| End-to-end | — | — | Golden set: one pinned document per lane through full triage |  | L2 |
| Accuracy | — | — | Triage precision/recall, typing accuracy, context correctness vs labels; −5 pt stratum gate |  | L3 |
| Published | — | — | Context stack on verdict pages; methodology table from harness output |  | L4 |

Triage has no lane-health surface; its instruments are the ADR-0012 funnel (drop rate, schema-failure rate, type-distribution shift) plus L2/L3.

**L1 fixture list**: checkability classes (claims, opinion, rhetoric, procedure, satire, pledge, question-forms); type-routing set (one per type); context variants (with/without proposal, ambiguous, identity-only, qualifiers); normalisation pairs (multi-clause omission-prone sentences); caption triage items (punctuation-less cues, tier/flag variants); idempotency corpus.

## 5. Open questions

1. **Checkability calibration** — what recall/precision trade-off to target before L3 numbers exist; the initial operating point is a judgement call.
2. **One pass or two** — checkability + typing in a single `generateObject` call vs separate passes; leaning per-stage for auditability. **Live divergence (Sept 2026):** the implementation folds typing into the checkability call (which returns `claimType` per sentence) and never calls `triage-typing`. A test pins the call set and the one role that is not called, so wiring it is a decision rather than an accident. This question was previously tangled with the fingerprint, which ADR-0023 removed; the `NOT IMPLEMENTED` stubs for both are gone with it.
3. **Fingerprint normalisation rules** — which canonicalisations apply before the key; versioned config, initial set unwritten.
4. **Type-taxonomy closure** — is `institution-citation` a distinct type or a stratum of `citation-backed` (routing identical; distinction analytic)?
5. **Drop-log sampling design** — sample size and stratification for the recall measurement.
6. **Pledge typing detail** — distinct type, or a flag on `other`?
7. **Caption sentence splitting** — ASR cues have no punctuation; segmentation without breaking cue-span anchoring.
8. **Dedupe embedding model** — shared with INGESTION Q8; unpinned.
9. **Determinism, given no usable sampling knob (Sept 2026)** — `claude-sonnet-5` ignores `temperature` and the configured seed is ignored on the OpenRouter path, so the checkability boundary and the verdict class both move between runs of identical input (measured: 31 vs 42 claims on one article; `not_enough_evidence` vs `supported` on one claim). Options: require agreement across N repeats before publishing a class; move the variance-critical roles to a seed-honouring model (an ADR-0011 routing change with a cost and quality trade); or measure the variance at L3 and disclose it rather than claim control. **Decided (Sept 2026) for the verdict class:** an agreement gate on the class-deciding step (VERIFICATION §2.7a) — the class is decided twice and only an agreed class is published, because no sampling knob works on the configured models. For triage the decision is measurement and disclosure, not control: the triage boundary stays a disclosed judgement (the verdict page says so), and the variance is an L3 measurement rather than something claimed as pinned. That asymmetry is deliberate — triage runs once per sentence per document, so agreeing it would multiply the dominant cost, while the class decision runs once per claim and is what a reader sees.