# Claim detection & triage design

*Status: proposed. Companion docs: docs/ARCHITECTURE.md, docs/VALIDATION-SLICE.md, docs/TEST-STRATEGY.md, docs/design/CROSS-CUTTING.md. ADRs: 0004, 0005, 0008, 0010, 0014.*

---

## 1. Purpose and slice scope

Triage is the pipeline's routing layer: it turns the document records ingestion emits (docs/design/INGESTION.md §3.1) into **claim records the verification engine and store consume**, and it decides what does *not* become a claim. Its jobs, per ADR-0005/0008 and the pipeline dataflow (ARCHITECTURE §2):

1. **Checkability triage** — LLM sentence-level classification: is this sentence a checkable claim?
2. **Claim typing** — statistical / citation-backed / broadcast-quote / institution-citation / false-context / other; the type selects the verification mode (ADR-0005's multi-mode engine).
3. **Claim fingerprint** — the canonical six-tuple (indicator × population × geography × time window × baseline × unit) that keys dedup, evidence-store matching, and cross-component idempotency (CROSS-CUTTING §6).
4. **Discourse-context extraction** — the optional typed fields of ADR-0008 (`attached_proposal`, `argument_direction`, …) over the stored window; these select which sensitivity-grid rows are **material** in the stat engine, so triage errors here propagate directly into verdict rendering.
5. **Publication/segment references** — the claim carries `publication_id` + `segment_id?` FKs into the ADR-0008 hierarchy; triage never duplicates publication/segment records, it references them.
6. **Drop logging** — every rejected sentence is logged with its window and rejection context. Triage recall is **measured, not assumed** (§2.5): the ADR-0010 harness labels a sample of what triage discarded.

Slice scope (VALIDATION-SLICE five lanes): triage runs on every ingested document — Beehive releases, RNZ articles, YouTube caption tracks, the institution source (The Kākā), and the curated false-context set (which carries pre-typed provenance items and skips checkability triage, but exercises typing and context extraction on the provenance stratum). Triage does **not** verify anything, never sees claimant identity as a decision input (ADR-0002 firewall), and never authors verdicts.

## 2. Design

### 2.1 Pipeline position and stage shape

```
[document record + attribution candidates + dedupe inputs]   ← from ingestion (INGESTION §3.4)
  → sentence split (deterministic; cue-span-preserving for captions)
  → per-sentence LLM triage: checkable? (generateObject, Zod-validated)
       ├─ no  → drop-log record (retained, evaluable)
       └─ yes → claim typing + fingerprint extraction (same or next LLM pass, §6)
              → discourse-context extraction (optional typed fields over the window)
              → claim record → verification queue + store
```

Per ADR-0008, triage gains the optional structured context pass over the window (+ segment/publication summaries as conditioning); fields are **extracted-if-present, never assumed** — absent = absent, never an inferred default. Per ADR-0011's routing table, triage/fingerprint/typing is the high-volume structured-extraction role (recommended: Gemini 3.8 Flash-class, batch-priced, harness-gated). Per ADR-0008 the context pass is Flash-class, batch-priced, and short-circuits cleanly.

### 2.2 Checkability triage

- Sentence-level, over the extracted text with the discourse window available as conditioning (never the reverse: the window never makes a non-claim checkable).
- Classes: checkable claim / not-checkable (opinion, rhetoric, procedure, satire — per MISINFO-TAXONOMY §2, satire is triaged *out*, never "checked") / pledge-conditional (future promise → "pledge — not yet checkable" per ADR-0004; checkable only as consistency claims against published forecasts).
- The output is a **decision + retained evidence**: the sentence text, the window span, and the rejection class when dropped. The prompt is a versioned artefact (CROSS-CUTTING §3).

### 2.3 Claim typing (mode routing)

The type routes the claim to exactly one verification mode (ADR-0005; the routing is the stat engine's front door):

| Claim type | Routes to | Detection signal at triage |
|---|---|---|
| `statistical` | stat-engine grid mode (fingerprint → evidence store → sensitivity grid) | quantified assertion against an indicator class; fingerprint extractable |
| `citation-backed` | citation-check mode (fetch cited doc, claim-vs-source) | explicit citation of a retrievable document in the window |
| `broadcast-quote` | quote-fidelity treatment (claim text vs caption/transcript text; media anchor) | caption/transcript-derived claim whose wording matters (ADR-0007 guardrails) |
| `institution-citation` | citation-check mode, institution lane stratum (R6) | institution-published claim paired with its own evidence (VALIDATION-SLICE lane 4) |
| `false-context` | provenance mode (curated set only in the slice) | `is_curated_fixture` provenance item, or decontextualised-content signal |
| `other` | general open-web loop (question decomposition, confidence-capped depth) | default; the least reliable mode, visibly capped per ADR-0005 |

Typing is conservative at the boundary: a statistical signal with an unusable fingerprint degrades to `other` **with the fingerprint attempt retained** — an untypeable statistical claim must not silently masquerade as a generic claim (see TRI-R3).

### 2.4 The claim fingerprint and dedup

- **Fingerprint** (statistical claims): the ADR-0005 six-tuple — indicator, population, geography, time window, baseline, unit — normalised into a canonical form (unit conversions, date phrasing, per-capita flags normalised before keying). Stored as structured fields + a normalised key; pgvector embedding over the claim text is the adjacent-match channel (ADR-0014).
- **Repeat handling** (ADR-0006): a fingerprint/embedding match to an existing claim adds a **source-occurrence** — never a new queue entry. Occurrences carry publication/segment references, so "everyone was saying it" stays auditable per lane.
- **Idempotency contract** (CROSS-CUTTING §6): triage is the cross-component key — re-running triage over the same document must resolve to the same claim records. Fingerprint normalisation is therefore versioned config: a normalisation change is a pipeline change that re-runs the harness (CROSS-CUTTING §7 table).
- **Non-merge conservatism**: near-fingerprint matches with different claimants, time windows, or contexts are flagged for review, not merged (the ING-R6 lesson applied at claim level).

### 2.5 Drop logging (recall is measured, not assumed)

Every dropped sentence writes a **drop-log record**: document/publication refs, sentence span, verbatim sentence, surrounding window, rejection class, prompt/model versions, `pipeline_version`. Drop-log records are first-class harness inputs:

- **Drop-rate telemetry** (ADR-0012 funnel): `triaged (checkable / dropped)` per lane × source; a **triage drop-rate shift** is the claim-detection-drift tripwire — threshold alert routed per ADR-0012.
- **Recall measurement**: the L3 harness draws a labelled sample from the drop log (stratified by lane) and labels "should this have been a claim?" — triage recall is a reported per-stratum number like any other, not an assumption. Under-detection that never enters the labelled-claim sample is invisible otherwise; this is the mechanism that makes it visible.
- Dropped sentences are retained with raw-document provenance (ADR-0006 reprocessing discipline), so a triage-prompt change can re-triage past drops and measure the delta.

### 2.6 What triage never does

- Never assigns verdicts, confidence, or verdict-class labels (ADR-0004 is the verification/adjudication contract, not triage's).
- Never resolves attribution (candidates pass through; ADR-0002 firewall).
- Never infers `attached_proposal` from speaker identity, party, or history — window text only (ADR-0008 guardrail).
- Never treats Tier-2 caption wording as reviewed text: caption-derived claims inherit `transcript_tier`, `caption_quality_flag`, and the "claim pointer, never evidence for a number" rule (ADR-0007).

## 3. Interfaces and contracts

### 3.1 Claim record (consumed by the verification engine and the store; Drizzle-typed, Zod-validated at the LLM boundary)

| Field | Meaning |
|---|---|
| `claim_id` | store key; stable under reprocessing |
| `publication_id` / `segment_id?` | ADR-0008 hierarchy FKs (publication always; segment where structure exists) |
| `sentence_span` / `utterance_text` | verbatim source span (the quotable artefact; never paraphrased into verdicts) |
| `text` | normalised standalone claim (CheckThat!-style projection; the utterance and window remain the auditable originals) |
| `claim_type` | enum: statistical / citation-backed / broadcast-quote / institution-citation / false-context / other |
| `fingerprint?` | six structured fields + normalised key (statistical only; retained attempt on degradation) |
| `embedding_ref` | pgvector input for adjacency/repeat matching |
| `discourse_context` | the ADR-0008 field set (§3.2) |
| `media_anchor?` / `transcript_tier?` / `caption_quality_flag?` | caption-sourced claims (INGESTION §3.2, ADR-0007) |
| `attribution_candidates` | pass-through from ingestion; unresolved |
| `is_curated_fixture?` | false-context set gate |
| `source_occurrences[]` | repeat-claim provenance (publication/segment refs per occurrence) |
| `pipeline_version` / `prompt_versions` / `model_version` | provenance tuple participation (CROSS-CUTTING §2) |

### 3.2 Discourse-context fields (all optional; extracted-if-present, never assumed — ADR-0008)

| Field | Source | Verification consequence |
|---|---|---|
| `speech_context` | publication record (deterministic) | venue/occasion metadata; `speech_context` on verdict pages |
| `policy_topic` | LLM pass over window (+ summaries) | question seeds; topic facets |
| `attached_proposal` | window text only | **selects MATERIAL grid rows**; renders the "as deployed" line when present |
| `argument_direction` | stance over the window; null when not confident | problem-vs-success framing; material-row selection |
| `context_qualifiers` | speaker's own qualifications | false-alarm protection for the grid (e.g. "up from a low base") |
| `window` | verbatim span, deterministic | the auditable artefact; quoted, never paraphrased |

Contract properties: a claim with all-null context fields still verifies (no hard gate — the page simply renders no "as deployed" line); every field is published on the verdict page and contestable through the standard mutation pathway.

### 3.3 Handoff contracts

- **To verification**: claim record + `claim_type` → mode routing; the context pack (claim + window + segment/publication summaries) attaches automatically per ADR-0008's default-pack rule.
- **To store**: claim record is append-idempotent on fingerprint; occurrences append.
- **To harness/export** (packages/harness): claim records export in AVeriTeC-aligned shape — claim text, speaker candidates, publisher, date, source URL, claim type, plus the label schema's verification-strategy field basis (ADR-0010 §5). The exported shapes are the shared Drizzle/Zod definitions; harness and store schema versions must match (CRO-R13).
- **Drop-log**: retained records with the same provenance tuple; readable by the harness for recall sampling, unread-by-pipeline rules per the blind-rule boundary do not apply (drop log is pipeline-owned), but drop-log labels live on the harness side.

## 4. Test risks

| ID | Risk | Where it lives | Consequence if untested | Detection signal |
|---|---|---|---|---|
| TRI-R1 | Over-detection: opinions, rhetoric, satire, or pledges promoted to checkable claims | Checkability classification | Verification spend on uncheckable text; verdicts on opinions breach the claims-not-persons posture; satire "checked" (MISINFO-TAXONOMY) | Labelled precision sample from claim records; pledge/satire fixture classes |
| TRI-R2 | Under-detection: checkable claims dropped silently | Checkability classification | Coverage collapses invisibly — the highest-harm claim classes (electoral process, selective stats) missing while the funnel looks healthy | Drop-log recall sample (§2.5); triage drop-rate shift alert (ADR-0012) |
| TRI-R3 | Claim-type misclassification routes a claim to the WRONG verification mode — the highest-consequence triage failure | Typing pass | A statistical claim sent to the generic open-web loop loses the sensitivity grid entirely — the flagship "accurate but incomplete" verdict becomes unreachable; institution claims miss citation-check | Per-type routing accuracy on L3 stratified labels; type-vs-verdict-path consistency check |
| TRI-R4 | Fingerprint collisions/misses break dedup — distinct claims merged, or repeats duplicated | Fingerprint extraction + normalisation | Corrupted claim graph, wrong occurrence counts, double verification spend, or swallowed repeat claims; ingest re-run invariant (CRO-R9) breaks | L1 fingerprint fixture pairs (collide / distinct / adjacent); double-run idempotency test |
| TRI-R5 | Discourse-context extraction errors silently change grid-row selection | Context pass → stat engine | Wrong `attached_proposal`/`argument_direction` foregrounds non-material grid rows — the "as deployed" line asserts a framing the speaker didn't deploy; verdicts rendered against invented context | Context-field labels in the L3 set; ablation run (with/without context conditioning, ADR-0008 consequence) |
| TRI-R6 | Context-field over-inference — proposal or stance filled from speaker identity/party instead of window text | Context pass guardrail | ADR-0008's no-inference guardrail breaks; partisan-context fabrications; the exact hallucinated-context failure ADR-0008's alternatives analysis rejected | L1 fixture: identity-only signals must yield null fields; published-window audit check |
| TRI-R7 | Normalised `text` drifts from `utterance_text` — the omission-of-context decomposition failure distorts semantics | Normalisation (utterance → standalone projection) | The pipeline verifies a claim the speaker didn't quite make; sub-claims incomplete or misleading (Hu et al. NAACL 2025) | Verbatim-vs-normalised fixture pairs; window-quote assertion on stored records |
| TRI-R8 | Verdict-class misalignment: claim records that cannot reach the four AVeriTeC classes (ADR-0004/0010) — e.g. pledges typed as generic checkable claims, or non-statistical claims structurally blocked from "accurate but incomplete" | Typing + record shape | Harness scoring misaligned to the benchmark universe; pledge/conditional states leak into four-class scoring | L1 schema assertion: every claim record carries the fields its target verdict classes require; pledge fixtures |
| TRI-R9 | Dropped-claim blindness — the drop log exists but is never sampled/labelled, so recall is assumed | Drop-log → harness | Triage quality asserted, never measured; under-detection drift invisible between releases | L3 run manifest asserts a drop-log sample was scored; drop-recall number present in per-stratum table |
| TRI-R10 | Model/provider drift changes triage behaviour between runs (ADR-0011's named hazard) | Triage + context pass model routing | Checkability/typing/context outputs shift after a silent provider upgrade; downstream verdict mix changes unexamined | L2 golden snapshots per PR; ADR-0011 version-pinning + re-run rule; gen_ai span version fields |
| TRI-R11 | Tier-2 caption wording treated as reviewed — ASR errors define claims that were never made | Caption-lane triage inputs | Fabrication-adjacent attribution (ADR-0007's worst failure mode); quote-fidelity stratum corrupted | `transcript_tier`/`caption_quality_flag` propagation assertions; quote-fidelity fixtures |
| TRI-R12 | Structured-output degradation — `generateObject` schema failures silently drop or truncate triage outputs | Triage/context LLM boundary | Claims lost mid-pipeline with no funnel signal; context fields half-populated | L1 schema-validation tests; Zod failure counters in funnel; drop-rate-vs-schema-failure correlation alert |
| TRI-R13 | Re-triage idempotency failure — the same document re-triaged (reprocessing, prompt bump) yields a different claim set without append discipline | Whole component | Duplicate claims, orphaned verdicts, audit-log ambiguity | L1 double-run invariance test (CROSS-CUTTING §6); re-triage diff assertion |

## 5. Test strategy

Every §4 risk maps to a test layer per docs/TEST-STRATEGY.md §2 — **L1** deterministic (every push), **L2** golden-set snapshots (every PR), **L3** accuracy harness (weekly + pre-release), **L4** site verification (L4a every push, L4b pre-release).

| Risk | Mitigation | Layer | When it runs |
|---|---|---|---|
| TRI-R1 | Labelled checkability fixtures: opinion/rhetoric/satire/pledge classes must NOT become claims; genuine claims in the same fixtures must. Pledge → `pledge — not yet checkable` state asserted, never a four-class verdict | L1 + L3 | Every push; weekly + pre-release (recall/precision numbers) |
| TRI-R2 | Drop-log recall sample: stratified labelled sample of dropped sentences scored at each L3 run; drop-rate shift threshold alert wired per ADR-0012 | L3 + Grafana monitor | Weekly + pre-release; continuous funnel alert |
| TRI-R3 | Routing-conformance test: fixture claims per type assert the verification mode they enter (statistical → stat engine; institution → citation-check; broadcast → quote-fidelity; false-context fixture → provenance mode). Per-type accuracy is an L3 stratified deliverable (VALIDATION-SLICE per-stratum table) | L1 + L2 + L3 | Every push; every PR (golden set spans all types); weekly |
| TRI-R4 | Fingerprint fixture triples: identical-normalisation pairs (must merge), near-tuple distinct claims (must not merge), adjacent-window variants (occurrence, not new claim). Normalisation round-trip tests incl. macrons/te reo and number formats | L1 | Every push |
| TRI-R5 | Grid-materiality integration test: fixture claim + context variants → asserted material-row selection differences in the stat engine; L3 context ablation (with/without conditioning) per ADR-0008's harness consequence | L1 + L3 | Every push; weekly + pre-release |
| TRI-R6 | Guardrail fixture: windows containing party/platform signals but no in-text proposal → asserted null `attached_proposal`; published window quoted on records so an audit can diff field vs window | L1 + L4a | Every push |
| TRI-R7 | Utterance/normalised-text pair fixtures with an assertion that the window, utterance, and normalised text all persist and the normalised text is derivable from the utterance + window | L1 + L2 | Every push; PR snapshots diff normalisation behaviour |
| TRI-R8 | Record-shape conformance: every emitted claim validates against the shared Drizzle/Zod export schema; pledge fixtures typed as conditional; verdict-class reachability asserted per type in the mode-routing test | L1 | Every push |
| TRI-R9 | Run-manifest assertion: an L3 scoring run without a scored drop-log sample fails preflight; drop-recall renders in the per-stratum table (L4 integrity check) | L1 + L3 + L4b | Every push (manifest schema); weekly + pre-release |
| TRI-R10 | Golden-set snapshots (~20 pinned claims incl. triage outputs) per PR with pinned model/prompt versions — any behavioural drift is a visible diff; ADR-0011 version-pin config asserted in L1 | L1 + L2 + L3 | Every push; every PR; any version change |
| TRI-R11 | Caption-lane triage fixtures: ASR-derived claims must carry tier/quality flags and the "claim pointer" treatment; a Tier-2 record missing flags fails schema validation | L1 + L4a | Every push |
| TRI-R12 | LLM-boundary tests: malformed/mismatched `generateObject` outputs → asserted failure-class record + funnel counter, never a silent skip; bounded retries asserted | L1 | Every push |
| TRI-R13 | Double-run invariance: triage over the same fixture corpus twice → identical claim IDs/counts; re-triage after a prompt bump appends versions with provenance, never overwrites | L1 + L2 | Every push; every PR |
| End-to-end triage behaviour | Golden set: one pinned document per lane through full triage (sentence split → checkability → typing → context) — snapshots show behavioural change to reviewers per PR | L2 | Every PR |
| Triage + context accuracy per stratum | L3 stratified labels: triage precision/recall, typing accuracy, context-field correctness vs labels; regression gate at −5 pts per stratum where n≥20 (TEST-STRATEGY §3) | L3 | Weekly + pre-release |
| Published surface | Context stack renders on verdict pages (window quote, frame fields, "as deployed" line where applicable); methodology-page accuracy table generated from harness output | L4 | L4a every push; L4b pre-release |

Triage has no lane-health surface of its own — its health instruments are the ADR-0012 funnel (drop rate, schema-failure rate, type distribution shift) plus L2/L3; a triage stage emitting no spans is caught by CROSS-CUTTING §5's instrumentation-completeness test (CRO-R7 pattern, applied to the triage stage).

### Per-triage fixture list (L1 surface)

| Fixture | Contents | Risks covered |
|---|---|---|
| Checkability classes | genuine claims; opinion; rhetorical flourish; procedure; satire (The Civilian-style); pledge/conditional; borderline question-forms | TRI-R1, R2 |
| Type-routing set | statistical (number + indicator); citation-backed (cited doc in window); broadcast-quote (Tier-2 caption); institution-citation (Kākā-style claim with own evidence); false-context fixture; generic `other` | TRI-R3, R8 |
| Fingerprint triples | identical-normalisation pair (merge); near-tuple distinct claims (no merge); adjacent-window repeat (occurrence, not new claim); macron/te reo + number-format normalisation variants | TRI-R4 |
| Context variants | same claim window with/without in-text proposal; stance-clear vs ambiguous; speaker-identity-only signals (must yield nulls); qualifier-bearing windows | TRI-R5, R6 |
| Normalisation pairs | utterance + window → standalone text, verbatim preserved; omission-prone multi-clause sentences | TRI-R7 |
| Caption triage items | ASR cue text lacking punctuation; Tier-1 vs Tier-2 records; missing-flag variants | TRI-R11, R12 |
| Idempotency corpus | fixture document set run twice; re-triage after a prompt-version bump | TRI-R13 |

## 6. Open questions

1. **Checkability calibration** — what recall/precision trade-off triage targets before L3 numbers exist, and who sets it. The drop-log recall sample makes the trade-off measurable from the first harness run; the initial operating point is a judgement call.
2. **One pass or two** — checkability + typing + fingerprint in a single `generateObject` call vs separate passes (ADR-0008 keeps the context pass separate and optional). Cost/latency vs per-stage observability; leaning per-stage for auditability, undecided.
3. **Fingerprint normalisation rules** — exactly which canonicalisations (case, number formats, date phrasing, macron forms) apply before the normalised key is computed; the rules are versioned config, but the initial rule set is unwritten.
4. **Type-taxonomy closure** — whether `institution-citation` is a distinct type or a stratum of `citation-backed` (routing is identical; the distinction is analytic), and what adjudicates the `other` boundary beyond the signals in §2.3.
5. **Drop-log sampling design** — sample size and stratification for the recall measurement (n per release; stratified by lane × rejection class), and whether the sample draws automatically per L3 run or is curated.
6. **Pledge/conditional typing detail** — how future pledges map onto the consistency-claim treatment against published forecasts (ADR-0004) at triage time: a distinct type, or a flag on `other`?
7. **Caption sentence splitting** — ASR cue text has no sentence punctuation; how sentences are segmented for checkability triage without breaking cue-span anchoring (cue-boundary vs inferred sentence spans).
8. **Dedupe embedding model** — which embedding model feeds claim-level repeat detection (shared with INGESTION §6 Q8; ADR-0011 routes embeddings but the slice's pick is unpinned).