# Claim detection & triage design

*ADRs: 0004, 0008, 0010, 0014, 0021, 0025, 0026. Companions: `ARCHITECTURE.md`,
`VALIDATION-SLICE.md`, `TEST-STRATEGY.md`, `CROSS-CUTTING.md`.*

## 1. Purpose and slice scope

Triage turns document records (INGESTION §3.1) into **claim records**, and decides what does *not*
become a claim. It does three things: two per-sentence arms, plus one context pass per checkable claim.

1. **Two independent arms per sentence.** Arm one decides *whose words* the sentence is — `quoted-actor`,
   `author-claim`, `outlet-prose` or `unresolved`. Arm two decides *what it is* — a checkable factual
   assertion, or opinion, rhetoric, procedure, satire, question, off-domain, or a pledge. The arms are
   independent because they overlap: a quoted actor can be stating an opinion, or be satirical. A
   sentence is checkable only when **both** arms pass (ADR-0025).
2. **Context extraction.** For each checkable claim, a context pass reads the **whole document** and
   records what argumentative point the claim supports, plus topic, venue and the speaker's own
   qualifiers (ADR-0008, ADR-0026).
3. **References and drops.** It links the claim to its publication and segment rather than copying the
   hierarchy, and it logs every rejected sentence with its class and reason. Recall is **measured, not
   assumed** (§2.5).

Triage runs on every ingested document. Triage never verifies, never writes a verdict, and never uses a
claimant's identity to decide anything (ADR-0002).

**Eligibility and reading are two arms, but the firewall is unchanged.** "Never uses a claimant's
identity to decide anything" governs how a claim is *read*. Each arm reads the sentence text and the
genre only — neither is given a claimant name, no party and no history — so neither can score the same
sentence differently by speaker. Identity decides *whether* a sentence is checked; it never decides
*what the check finds* (ADR-0008, ADR-0025).

## 2. Design

### 2.1 Stage shape

```
[document record + genre + dedupe inputs]
  → sentence split (deterministic; cue-span-preserving for captions)
  → arm 1 (speakership): one class per sentence
       ├─ not eligible → drop-log record (retained, evaluable)
       └─ eligible     → arm 2 (content): one class per eligible sentence
                            ├─ not checkable → drop-log record
                            └─ checkable     → context pass over the whole document
                                                 → claim record → verification queue
```

Two calls decide a sentence (ADR-0025), and verification is one research loop (ADR-0026), so there is no
separate typing call and no verification mode to record.

Model routing (ADR-0011): triage is the high-volume structured-extraction role. Sampling settings live
on the shared config surface (`SAMPLING`, CROSS-CUTTING §2) and are passed on every call — **but they
are advisory, and on the configured models they are discarded.** The SDK warns that `claude-sonnet-5`
ignores `temperature` and that the OpenRouter model ignores `seed`. Determinism for triage is
*measurement and disclosure*, not control (open question 9).

### 2.2 Two arms, two vocabularies (ADR-0025)

Both arms run per sentence. The window can support a claim but never turns a non-claim into a checkable
one. Arm two runs only on sentences that pass arm one, because the two questions have different inputs.

**Arm one — whose words the sentence is:**

| Class | Eligible | Meaning |
|---|---|---|
| `quoted-actor` | **yes** | Reported speech, speaker resolvable from quotation and attribution |
| `author-claim` | **yes** | The author of an opinion/analysis piece asserting in their own voice |
| `outlet-prose` | no | Journalist/outlet narration, synthesis, scene-setting |
| `unresolved` | no | A quotation whose speaker cannot be resolved — never guessed |

**Arm two — what the sentence is:**

| Class | Checkable | Meaning |
|---|---|---|
| `checkable` | **yes** | A factual assertion evidence could settle |
| `opinion` | no | An evaluation or value judgement, not a falsifiable assertion |
| `rhetoric` | no | Persuasive framing with no factual content |
| `procedure` | no | A procedural statement about proceedings |
| `satire` | no | Satire is set aside, never "checked" |
| `question` | no | A question, not an assertion |
| `off-domain` | no | Outside the project's policy remit |
| `pledge-conditional` | held | A commitment; gradable only once its deadline passes |

Arm two judges what the sentence asserts, not who said it: a quotation of a factual claim is checkable
even though it is reported speech.

The genre is declared by the lane and passed with the request, because the failure direction of a wrong
genre is the dangerous one: a news report mislabelled `opinion-analysis` makes the reporter's own
assertions eligible. `author-claim` is available only when the genre is `opinion-analysis`.

A sentence an arm does not answer falls closed: `unresolved` at arm one, `off-domain` at arm two — never
promoted to a claim, so a missing answer can never look like coverage.

**Call bound (TRI-R12).** The call returns one result per sentence, so its response grows
with the document while the adapter's output budget is fixed. The document is split into chunks of at
most **20 sentences or 6000 characters** (whichever binds first), and a chunk whose response fails
schema validation is retried at **half size** before the document is failed. A document that fits in
one chunk still makes exactly one call. `triage_record.sentences_read` counts the whole document across
chunks, so a partially-read document can never publish as fully read; token counts are summed; the run's
provenance records **one** model, so chunks that disagree fail loudly.

### 2.3 Discourse context (ADR-0008, ADR-0026)

One context pass per checkable claim. It reads the **whole document** — not a moving window — and
answers what the claim is doing in the speaker's argument.

| Field | Source | Verification consequence |
|---|---|---|
| `speechContext` | whole document (venue) | venue/occasion metadata beside the who-line |
| `policyTopic` | whole document | topic facets for the research plan |
| `supports` | whole document | the argumentative point the claim supports — the "why it matters" link, and a seed for the research plan |
| `contextQualifiers` | speaker's own qualifications | false-alarm protection ("up from a low base") |
| `window` | verbatim span, deterministic | the auditable artefact; quoted, never paraphrased |

`supports` is one field, read over the whole document, because the point a claim supports is a single
idea. A claim whose sentence has **no window** still gets a context pass (the document is the
input); if there is no document text either, the context is all-null, because absent is data.

A claim with all-null context still verifies; every field is published and contestable.

### 2.4 Dedup and idempotency

- **Repeats.** The pgvector embedding that would catch near matches is **designed but not wired**:
  `claim.embedding` exists and nothing populates it, so no embedding provider is routed. What does run
  is the exact content key (`claim.claim_key`), which is what makes re-running idempotent.
- **Idempotency.** Re-running triage on the same document resolves to the same claim records. The claim
  key is derived from sentence text, window and the class.
- **No merging on near matches.** Near matches are not detected at all today, because the embedding is
  unwired. That is a gap, not a design choice.

### 2.5 Drop logging (recall is measured, not assumed)

Every dropped sentence writes a drop-log record: references, span, verbatim text, window, class, and the
provenance tuple. Those records are inputs to the harness, not a by-product.

- **One funnel.** `triaged (checkable / dropped)` per lane, from a single log, because both arms write
  the same log (ADR-0025). "Not a claim" and "not ours to check" stay visibly different in the recorded
  class, but they are counted in one place.
- **Recall measurement.** The L3 harness labels a sample of the drop log — "should this have been a
  claim?" — so triage recall is a reported number.
- **Re-triage.** Dropped sentences are kept with their provenance, so a prompt change can re-triage past
  drops and measure the difference.

### 2.6 What triage never does

Triage never assigns a verdict or a confidence — that is the research loop's contract (ADR-0004,
ADR-0026). It never resolves attribution beyond naming the speaker the text attributes the words to. It
never infers context from speaker identity, party, or history; document text only (ADR-0008). And it
never treats Tier-2 caption wording as reviewed text (ADR-0007).

## 3. Interfaces

### 3.1 Claim record (Drizzle-typed, Zod-validated at the LLM boundary)

| Field | Meaning |
|---|---|
| `claim_id` | store key; stable under reprocessing |
| `publication_id` / `segment_id?` | ADR-0008 FKs |
| `sentence_span` / `utterance_text` | verbatim source span — the quotable artefact, never paraphrased into verdicts |
| `text` | normalised standalone claim |
| `speakership_class` | the eligible class that made it a claim (`quoted-actor` / `author-claim`) |
| `speakership_method` / `genre` | how the class was decided, and the rule that selected it |
| `discourse_context` | the ADR-0008 field set (§2.3), with `supports` |
| `media_anchor?` / `transcript_tier?` / `caption_quality_flag?` | caption-sourced claims |
| `attribution_candidates` | the speaker the text attributes, unresolved as an entity |
| `is_curated_fixture?` | false-context gate |
| `source_occurrences[]` | repeat provenance |
| `pipeline_version` / `prompt_versions` / `model_version` | provenance tuple |

### 3.2 Handoffs

- **To verification**: claim record + discourse context, from which the research plan is built
  (ADR-0026); the default context pack attaches automatically (ADR-0008).
- **To the store.** Writes are append-idempotent on the claim's content identity (`claim.claim_key`,
  unique on sentence text plus window plus class). Occurrences append. It cannot withdraw a claim a
  later run would not make: the graph grows with the union across runs, because a published claim is
  not retractable.
- **To harness**: exports in AVeriTeC-aligned shape via the shared Drizzle/Zod definitions; harness and
  store schema versions must match.
- **Drop-log**: pipeline-owned (blind rule doesn't apply to it); its *labels* live on the harness side.

## 4. Tests

Every risk maps to a layer in `TEST-STRATEGY.md`: **L1** every push, **L2** every PR, **L3** weekly and
pre-release, **L4a** every push, **L4b** pre-release.

| ID | Risk | Consequence if untested | Test | Signal | Layer |
|---|---|---|---|---|---|
| TRI-R1 | Over-detection: opinions/rhetoric/satire/pledges promoted to claims | Verification spend on uncheckable text; satire "checked" | Checkability fixtures: each non-checkable class must NOT become a claim; eligible classes must | Labelled precision sample; class fixtures | L1 + L3 |
| TRI-R2 | Under-detection: checkable claims dropped silently | Highest-harm classes missing while the funnel looks healthy | Drop-log recall sample scored at each L3 run; drop-rate alert wired | Drop-log recall sample; drop-rate shift alert | L3 + monitor |
| TRI-R3 | *(retired)* Wrong typing. There is no type to get wrong (ADR-0026) | — | — | — | — |
| TRI-R4 | Claim-key collisions/misses break dedup | Corrupted claim graph; double spend or swallowed repeats | Double-run idempotency; content-key round-trips | Double-run invariance | L1 |
| TRI-R5 | Context-extraction errors change the research plan | The plan chases the wrong question | Context variants → asserted `supports`; L3 context ablation | Context labels in L3 | L1 + L3 |
| TRI-R6 | Context over-inference from speaker identity/party | ADR-0008's no-inference guardrail broken | Identity-only text → asserted null fields | Fixture: identity-only signals → null | L1 |
| TRI-R7 | Normalised text drifts from utterance | Pipeline verifies a claim the speaker didn't quite make | Utterance/window/text persistence asserted | Verbatim-vs-normalised fixture pairs | L1 + L2 |
| TRI-R8 | Verdict-class misalignment | Harness scoring misaligned to the benchmark universe | Every claim validates against the shared export schema | Schema assertion per verdict class | L1 |
| TRI-R9 | Drop log exists but is never sampled | Triage quality asserted, never measured | L3 run without a scored drop-log sample fails preflight | Run-manifest asserts a drop-log sample scored | L1 + L3 |
| TRI-R10 | Model/provider drift changes triage behaviour | Outputs shift after silent upgrades | Golden snapshots per PR with pinned versions | L2 golden snapshots | L1 + L2 + L3 |
| TRI-R11 | Tier-2 caption wording treated as reviewed | ASR errors define unmade claims (ADR-0007) | ASR-derived claims must carry tier/quality flags | Tier/flag propagation assertions | L1 |
| TRI-R12 | `generateObject` schema failures silently drop outputs | Claims lost mid-pipeline, no funnel signal | Malformed LLM outputs → failure-class record + counter; chunk halving | Zod failure counters; drop-rate-vs-schema-failure alert | L1 |
| TRI-R13 | Re-triage idempotency failure | Duplicate claims, orphaned verdicts | Double-run invariance: identical claim IDs/counts | Double-run invariance test | L1 + L2 |
| End-to-end | — | — | Golden set: one pinned document per lane through full triage |  | L2 |
| Accuracy | — | — | Triage precision/recall and context correctness vs labels; −5 pt stratum gate |  | L3 |
| Published | — | — | Context stack on verdict pages; methodology table from harness output |  | L4 |

**L1 fixture list**: class fixtures (one per class in §2.2); context variants (with/without supports,
ambiguous, identity-only, qualifiers); normalisation pairs; caption triage items; idempotency corpus.

## 5. Open questions

1. **Checkability calibration** — what recall/precision trade-off to target before L3 numbers exist; the initial operating point is a judgement call.
2. ~~**One pass or two**~~ **Resolved (ADR-0025)**: one call decides the class; there is no second typing pass.
3. **Dedupe embedding model** — unpinned; the near-match contract is unmet (INGESTION Q8).
4. **Drop-log sampling design** — sample size and stratification for the recall measurement.
5. **Pledge typing detail** — the class is held; confirm the store status it maps to once the deadline logic lands.
6. **Caption sentence splitting** — ASR cues have no punctuation; segmentation without breaking cue-span anchoring.
7. **Determinism, given no usable sampling knob** — `claude-sonnet-5` ignores `temperature` and the configured seed is ignored on the OpenRouter path, so the class boundary moves between runs. Decision: measurement and disclosure for triage (it runs once per sentence per document); the class-agreement gate covers the published verdict class (ADR-0026 §4).
