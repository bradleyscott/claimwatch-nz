# Claim detection & triage design

*Proposed. ADRs: 0004, 0005, 0008, 0010, 0014. Companions: `ARCHITECTURE.md`, `VALIDATION-SLICE.md`, `TEST-STRATEGY.md`, `CROSS-CUTTING.md`.*

## 1. Purpose and slice scope

Triage turns document records (INGESTION §3.1) into **claim records** and decides what does *not* become a claim. Its jobs:

1. **Checkability triage** — LLM sentence-level: checkable claim or not?
2. **Claim typing** — statistical / citation-backed / broadcast-quote / institution-citation / false-context / other; the type selects the verification mode.
3. **Claim fingerprint** — the six-tuple (indicator × population × geography × time window × baseline × unit) keying dedup, evidence-store matching, and idempotency.
4. **Discourse-context extraction** — the optional typed ADR-0008 fields over the stored window; these select **material** grid rows in the stat engine, so errors here propagate into verdict rendering.
5. **Publication/segment references** — the claim carries `publication_id` + `segment_id?` FKs; triage references the hierarchy, never duplicates it.
6. **Drop logging** — every rejected sentence logged with window and rejection context. Triage recall is **measured, not assumed** (§2.5).

Slice scope: triage runs on every ingested document. The false-context set skips checkability triage (pre-typed provenance items) but exercises typing and context extraction. Triage never verifies anything, never sees claimant identity as a decision input (ADR-0002), never authors verdicts.

## 2. Design

### 2.1 Stage shape

```
[document record + attribution candidates + dedupe inputs]
  → sentence split (deterministic; cue-span-preserving for captions)
  → per-sentence LLM triage: checkable?
       ├─ no  → drop-log record (retained, evaluable)
       └─ yes → typing + fingerprint → context extraction → claim record → verification queue + store
```

Model routing per ADR-0011: triage/typing/fingerprint is the high-volume structured-extraction role (Flash-class, batch-priced, harness-gated); the context pass is separate, Flash-class, short-circuits cleanly.

### 2.2 Checkability

Sentence-level; the window conditions but never makes a non-claim checkable. Classes: checkable / not-checkable (opinion, rhetoric, procedure, satire — satire is triaged *out*, never "checked") / pledge-conditional (→ "pledge — not yet checkable", checkable only as consistency claims). Output is decision + retained evidence (sentence, window span, rejection class). The prompt is a versioned artefact.

### 2.3 Claim typing (mode routing)

| Type | Routes to | Signal |
|---|---|---|
| `statistical` | stat-engine grid mode | quantified assertion; fingerprint extractable |
| `citation-backed` | citation-check mode | explicit citation of a retrievable document |
| `broadcast-quote` | quote-fidelity mode | caption-derived claim whose wording matters |
| `institution-citation` | citation-check mode, institution stratum (R6) | institution claim paired with own evidence |
| `false-context` | provenance mode (curated set only) | `is_curated_fixture` item, or decontextualisation signal |
| `other` | open-web loop (capped) | default; least reliable mode |

Conservative at the boundary: a statistical signal with an unusable fingerprint degrades to `other` **with the fingerprint attempt retained** — never silently generic (TRI-R3).

### 2.4 Fingerprint and dedup

- **Fingerprint**: the ADR-0005 six-tuple, normalised (units, date phrasing, per-capita flags) into structured fields + canonical key; pgvector embedding over claim text is the adjacent-match channel.
- **Repeat handling**: fingerprint/embedding match adds a **source-occurrence** — never a new queue entry. Occurrences carry publication/segment refs.
- **Idempotency**: re-running triage over the same document resolves to the same claim records. Fingerprint normalisation is versioned config — a normalisation change is a pipeline change that re-runs the harness.
- **Non-merge conservatism**: near-fingerprint matches with different claimant/window/context are flagged for review, not merged.

### 2.5 Drop logging (recall is measured, not assumed)

Every dropped sentence writes a drop-log record (refs, sentence span, verbatim text, window, rejection class, provenance tuple). Drop-log records are first-class harness inputs:

- **Drop-rate telemetry**: `triaged (checkable / dropped)` per lane; a drop-rate shift is the claim-detection-drift tripwire.
- **Recall measurement**: the L3 harness labels a stratified sample of the drop log — "should this have been a claim?" — so triage recall is a reported number like any other. Without this, under-detection is invisible: what was never detected never enters the labelled-claim sample.
- Dropped sentences retained with provenance, so a prompt change can re-triage past drops and measure the delta.

### 2.6 What triage never does

Never assigns verdicts or confidence (ADR-0004 is adjudication's contract) · never resolves attribution (ADR-0002 firewall) · never infers `attached_proposal` from speaker identity, party, or history — window text only (ADR-0008) · never treats Tier-2 caption wording as reviewed text — caption claims inherit `transcript_tier` and the "claim pointer, never evidence for a number" rule (ADR-0007).

## 3. Interfaces

### 3.1 Claim record (Drizzle-typed, Zod-validated at the LLM boundary)

| Field | Meaning |
|---|---|
| `claim_id` | store key; stable under reprocessing |
| `publication_id` / `segment_id?` | ADR-0008 FKs |
| `sentence_span` / `utterance_text` | verbatim source span — the quotable artefact, never paraphrased into verdicts |
| `text` | normalised standalone claim (the utterance and window remain the auditable originals) |
| `claim_type` | enum (§2.3) |
| `fingerprint?` | six fields + normalised key (statistical; attempt retained on degradation) |
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

### 3.3 Handoffs

- **To verification**: claim record + type → mode routing; the default context pack attaches automatically (ADR-0008).
- **To store**: append-idempotent on fingerprint; occurrences append.
- **To harness**: exports in AVeriTeC-aligned shape via the shared Drizzle/Zod definitions; harness and store schema versions must match.
- **Drop-log**: pipeline-owned (blind rule doesn't apply to it); its *labels* live on the harness side.

## 4. Test risks

| ID | Risk | Consequence if untested | Detection signal |
|---|---|---|---|
| TRI-R1 | Over-detection: opinions/rhetoric/satire/pledges promoted to claims | Verification spend on uncheckable text; satire "checked" | Labelled precision sample; pledge/satire fixtures |
| TRI-R2 | Under-detection: checkable claims dropped silently | Highest-harm classes missing while the funnel looks healthy | Drop-log recall sample; drop-rate shift alert |
| TRI-R3 | **Wrong-mode routing — the highest-consequence triage failure** | A statistical claim sent to open-web loses the grid entirely; the flagship verdict becomes unreachable | Per-type routing accuracy; type-vs-verdict-path check |
| TRI-R4 | Fingerprint collisions/misses break dedup | Corrupted claim graph; double spend or swallowed repeats | Fingerprint fixture pairs; double-run idempotency |
| TRI-R5 | Context-extraction errors silently change grid-row selection | "As deployed" asserts a framing the speaker didn't deploy | Context labels in L3; with/without-context ablation |
| TRI-R6 | Context over-inference from speaker identity/party | ADR-0008's no-inference guardrail broken; partisan fabrications | Fixture: identity-only signals → null fields |
| TRI-R7 | Normalised text drifts from utterance (omission-of-context failure) | Pipeline verifies a claim the speaker didn't quite make | Verbatim-vs-normalised fixture pairs |
| TRI-R8 | Verdict-class misalignment — records that can't reach the four classes (pledges typed as generic) | Harness scoring misaligned to the benchmark universe | Schema assertion: fields per target verdict class; pledge fixtures |
| TRI-R9 | Drop log exists but is never sampled — recall assumed | Triage quality asserted, never measured | Run-manifest asserts a drop-log sample scored |
| TRI-R10 | Model/provider drift changes triage behaviour | Outputs shift after silent upgrades; verdict mix changes unexamined | L2 golden snapshots; version pinning |
| TRI-R11 | Tier-2 caption wording treated as reviewed | ASR errors define unmade claims (ADR-0007's worst failure) | Tier/flag propagation assertions |
| TRI-R12 | `generateObject` schema failures silently drop outputs | Claims lost mid-pipeline, no funnel signal | Zod failure counters; drop-rate-vs-schema-failure alert |
| TRI-R13 | Re-triage idempotency failure — same document re-triaged yields a different claim set | Duplicate claims, orphaned verdicts | Double-run invariance test |

## 5. Test strategy

Every risk maps to a layer per TEST-STRATEGY (L1 every push; L2 every PR; L3 weekly + pre-release; L4a every push, L4b pre-release). Highlights:

| Risk | Mitigation | Layer |
|---|---|---|
| TRI-R1 | Checkability fixtures: opinion/rhetoric/satire/pledge must NOT become claims; genuine claims must | L1 + L3 |
| TRI-R2 | Drop-log recall sample scored at each L3 run; drop-rate alert wired | L3 + monitor |
| TRI-R3 | Routing-conformance fixtures per type assert the mode entered; per-type accuracy is an L3 deliverable | L1 + L2 + L3 |
| TRI-R4 | Fingerprint triples: same-normalisation merge; near-tuple no-merge; adjacent-window occurrence; macron/number-format round-trips | L1 |
| TRI-R5 | Grid-materiality integration: context variants → asserted material-row differences; L3 context ablation | L1 + L3 |
| TRI-R6 | Identity-only windows → asserted null `attached_proposal` | L1 |
| TRI-R7 | Utterance/window/text persistence asserted; normalisation derivable from utterance + window | L1 + L2 |
| TRI-R8 | Every claim validates against the shared export schema; pledge fixtures typed conditional | L1 |
| TRI-R9 | L3 run without a scored drop-log sample fails preflight | L1 + L3 |
| TRI-R10 | Golden snapshots per PR with pinned versions | L1 + L2 + L3 |
| TRI-R11 | ASR-derived claims must carry tier/quality flags — missing flags fail schema validation | L1 |
| TRI-R12 | Malformed LLM outputs → failure-class record + counter, never a silent skip | L1 |
| TRI-R13 | Double-run invariance: identical claim IDs/counts; re-triage appends versions | L1 + L2 |
| End-to-end | Golden set: one pinned document per lane through full triage | L2 |
| Accuracy | Triage precision/recall, typing accuracy, context correctness vs labels; −5 pt stratum gate | L3 |
| Published | Context stack on verdict pages; methodology table from harness output | L4 |

Triage has no lane-health surface; its instruments are the ADR-0012 funnel (drop rate, schema-failure rate, type-distribution shift) plus L2/L3.

**L1 fixture list**: checkability classes (claims, opinion, rhetoric, procedure, satire, pledge, question-forms); type-routing set (one per type); fingerprint triples + normalisation variants; context variants (with/without proposal, ambiguous, identity-only, qualifiers); normalisation pairs (multi-clause omission-prone sentences); caption triage items (punctuation-less cues, tier/flag variants); idempotency corpus.

## 6. Open questions

1. **Checkability calibration** — what recall/precision trade-off to target before L3 numbers exist; the initial operating point is a judgement call.
2. **One pass or two** — checkability + typing + fingerprint in a single `generateObject` call vs separate passes; leaning per-stage for auditability.
3. **Fingerprint normalisation rules** — which canonicalisations apply before the key; versioned config, initial set unwritten.
4. **Type-taxonomy closure** — is `institution-citation` a distinct type or a stratum of `citation-backed` (routing identical; distinction analytic)?
5. **Drop-log sampling design** — sample size and stratification for the recall measurement.
6. **Pledge typing detail** — distinct type, or a flag on `other`?
7. **Caption sentence splitting** — ASR cues have no punctuation; segmentation without breaking cue-span anchoring.
8. **Dedupe embedding model** — shared with INGESTION Q8; unpinned.