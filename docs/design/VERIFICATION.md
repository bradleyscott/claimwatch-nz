# Verification engine design

*Status: proposed. Companion docs: docs/ARCHITECTURE.md, docs/VALIDATION-SLICE.md, docs/TEST-STRATEGY.md, docs/design/CROSS-CUTTING.md. ADRs: 0001, 0005, 0008, 0011, 0018.*

## 1. Purpose and slice scope

The verification engine turns triaged claims into **verdict + confidence + evidence pack + audit result**, appended to the store (ADR-0005). It is multi-mode by design because misleading-information classes differ in mechanism (docs/MISINFO-TAXONOMY.md): a true-but-selective statistic is not checkable the same way as a miscaptioned clip or a think-tank report citing its own evidence. The engine is where the project's two research-grounded bets live: **retrieval is the primary bottleneck** (gold evidence improves verdict accuracy 14–22 pts — AVeriTeC cross-benchmark findings), so every mode that can anchor to a specific source does; and **verification is much more reliable claim-vs-specific-source than claim-vs-open-web**, so the open-web loop is the capped catch-all, not the default.

Slice modes (per VALIDATION-SLICE "Verification: full multi-mode path"):

| Mode | Claims routed | Slice exercise |
|---|---|---|
| Stat-engine grid | statistical claims (R2) | Beehive/RNZ/institution statistical claims → fingerprint + sensitivity grid over official series |
| Citation-check | institution claims (R6, ADR-0018) | The Kākā claims paired with own evidence → fetch cited doc, claim-vs-source |
| Quote-fidelity | broadcast claims (R3) | claim text vs Tier-2 caption text; media_anchor generated |
| Provenance | false-context samples (R5) | curated ~10-item set only — demonstrate, never production-ready |
| Open-web loop | everything else (catch-all) | capped, labelled, most visibly open to contest (ADR-0005) |

Shared by all modes: question decomposition, confidence-capped retrieval depth (FIRE pattern — 7.6× LLM / 16.5× search cost reduction at comparable accuracy), extraction ladder with **Tier-2 fallback rate logged per lane** (R7 measured as a by-product), evidence-pack assembly with vintages + Internet Archive snapshots, and the **NLI justification audit as the publication gate** — the accuracy gate runs before publication, not after (VALIDATION-SLICE; ADR-0006).

Not in this component: extraction (ingestion), claim detection/typing/fingerprint *authoring* (triage), verdict mutation after publication (contestation slice), the harness itself (docs/design/HARNESS.md).

## 2. Design

### 2.1 Mode routing

Triage assigns claim type; the engine routes on it. Routing is a pure function of the claim record — no claimant identity ever enters the engine (ADR-0005 structural firewall).

```
claim.type ──▶ statistical        → stat-engine grid mode
           ──▶ citation-backed    → citation-check mode
           ──▶ quote-fidelity     → quote-fidelity mode
           ──▶ false-context      → provenance mode (curated set only)
           ──▶ other              → open-web loop (capped)
```

Misroutes are a first-class failure: a citation-backed claim pushed to the open-web loop loses the reliability of claim-vs-specific-source. The router's decision is stored on the evidence pack with the claim type, so L3 can measure per-mode accuracy on the *routed* stratum and catch routing drift.

### 2.2 Stat-engine grid mode (flagship)

Per ADR-0005 and ARCHITECTURE §4:

1. **Fingerprint match** — the claim's fingerprint (indicator × population × geography × time window × baseline × unit) is matched against the claim-anchored evidence store. Hit → resolve from accumulated, versioned series; miss → retrieve from verifier authorities per the domain's authority map (SOURCE-TAXONOMY Part 2). Retrieval resumes from stored evidence; it does not restart.
2. **Series retrieval** — official series only (Stats NZ Aotearoa Data Explorer SDMX/JSON, policedata.nz, MoJ, Treasury…), stored as `evidence_item` rows with `vintage_date` + `archive_snapshot_url` (docs/design/STORE.md). The release's own cited numbers are never the evidence — we reconstruct the field.
3. **Sensitivity grid** — pre-declared axes (`grid_axes_version` in the config tuple, CROSS-CUTTING §2), computed on demand: window variants with endpoint-trick detection, raw vs per-capita, denominator family (per-domain: recorded crime vs victim survey; net vs gross migration; the three child-poverty measures), comparison cohorts, seasonality/averaging. The LLM selects which grid rows are **material** to the claim's deployment (`argument_direction` / `attached_proposal` per ADR-0008); it never authors the grid. Identical axes for every claimant — the anti-invented-standard defence.
4. **Verdict** — robust across grid → Supported; material alternatives contradict the impression → Conflicting Evidence–Cherry-picking ("accurate but incomplete"); no canonical series / insufficient evidence → Not Enough Evidence (routed with visibly lower reliability per ADR-0005). A number matching *no* grid row is Refuted, not cherry-picked — the class boundary is arithmetic, not vibes. Never "false" for a true-but-selective number. The "as deployed" line renders only when `attached_proposal` exists in the stored window (absent ≠ defaulted, ADR-0008).
5. Presentation contract: chart-first, alternatives table, grid axes shown on the verdict page (ADR-0005).

### 2.3 Citation-check mode

For claims paired with their own evidence (institution lane, ADR-0018; also any claim whose text cites a source):

1. **Fetch the cited document** server-side (fetch-from-source discipline, ADR-0006; paywall policy applies — cited sources that are paywalled degrade to quoted-claim-only treatment, never circumvention).
2. **Bounded claim-vs-source comparison**: does the document say what the claim says it says — numbers, period, population, direction? Per ADR-0011's task analysis this is an extraction-precision task (Claude Sonnet 5-class routing, harness-gated), not open-web reasoning. Whether the citation does direct or decorative argumentative work (per ADR-0010's context taxonomy) sets how strictly the check binds.
3. **Authority discipline**: the cited document is the *object of the check*, never evidence. An NZIER Consensus Forecasts claim checks as a consistency claim against the document itself; an NZ Initiative statistic checks against Stats NZ via 2.2 if it is statistical. Advocacy-produced data is at best T6 and never a verdict basis (ADR-0018).
4. Verdict: Supported / Refuted against the cited source's actual content; mismatch between claim and cited source is the finding, stated as claim-vs-source, not as characterisation of the claimant.

### 2.4 Quote-fidelity mode

For caption-sourced broadcast claims (ADR-0007 machinery, Lane 3):

1. **Input posture**: the claim text derives from Tier-2 (publisher-auto ASR) or Tier-1 (publisher-reviewed) captions; the claim record carries `media_anchor {media_url, start_s, end_s, deep_link}`, `transcript_tier`, and the stored cue span.
2. **Comparison**: the claim's quoted wording against the stored caption text — the mode checks *fidelity of the quote to the record we hold*, never to the audio (no self-generated transcription exists; ADR-0007). Known ASR hazard classes: homophones, punctuation/segmentation, number formatting, te reo passages in otherwise-English speech.
3. **Guardrails carried into the verdict**: caption-derived text is a claim pointer, never evidence for a quoted number — numerical claims route to 2.2 regardless of caption wording (ING-R/lane-3 rule). Claims whose exact wording matters get "verification limited to the quoted claim" treatment; verdict pages state wording rests on unreviewed ASR and link the video + timestamp (the "hear it" control renders from the stored anchor only).
4. **media_anchor generation** is a verification-side responsibility for claims arriving without one (e.g. quote-fidelity claims assembled from window text): anchor = utterance span (cue span ± pad) + deep link, built only from stored cue timestamps. A claim that cannot be anchored is published as an open question, not a verdict with a dead-end quote.
5. Tier-2 fallback rate for caption parsing is logged per lane (R7); quote-fidelity verdicts carry the `caption_quality_flag`.

### 2.5 Provenance mode (curated set only — demonstrate, don't pretend)

For the ~10 hand-curated false-context fixtures (VALIDATION-SLICE lane 5):

- Instrument: the stored discourse window (ADR-0008) + retrieval of the original context (date, source, place of the image/clip), compared to the claimed context (MISINFO-TAXONOMY class 4 — decontextualisation, 59.3% of EU-2024 verified disinformation).
- Verdict vocabulary: "false context" as first-class finding — genuine content, wrong when/where/who, with the true context shown (MISINFO-TAXONOMY §3).
- **Posture**: this mode is the least mature. It runs on the curated fixture set only (`is_curated_fixture=true`); it registers with no lane health, no scheduler, no alerting; it produces per-stratum accuracy numbers for the harness and a demonstration path for the site, and the methodology page says exactly that. No live false-context detection is claimed (ING-R10 posture).

### 2.5a Open-web loop (the capped catch-all)

FIRE-style loop per ADR-0006's retrieval discipline: question generation beats claim-string search (conditioned on the ADR-0008 context pack — decompose the *argument* where one exists); multi-hop conditional retrieval; hybrid retrieval over the store (pgvector + FTS) then search APIs; **confidence-capped dynamic depth** — the loop stops when evidence suffices or the cap binds. Least reliable mode (AVeriTeC ceiling applies): capped, labelled, verdicts most visibly open to contest. It is the regression target for Layer 1 (AVeriTeC) from week 1 (ADR-0010).

### 2.6 Shared spine (all modes)

| Spine element | Behaviour |
|---|---|
| Context pack input | claim + discourse window + segment summary + publication summary + metadata (ADR-0008 default pack); on-demand expansion (full segment/publication/adjacent segments) each logged with a structured reason. Claimant identity never enters — structural firewall (ADR-0005). |
| Question decomposition | per-mode seeds: stat mode decomposes the fingerprint's implicit questions; open-web decomposes the argument; citation/quote modes generate comparison questions against the specific source. |
| Confidence-capped retrieval depth | per ADR-0006 (FIRE): depth cap config per mode; cap binding is stored on the evidence pack (a capped run is visible, not silent). |
| Extraction-ladder fallback logging | every evidence fetch runs the extraction ladder (deterministic → Tier-2 → degraded); Tier-2 fallback events land in `fallback_log` per lane (R7 by-product; the markup-drift instrument). |
| Evidence-pack assembly | items with vintage_date + archive_snapshot_url, grid result where applicable, justifications, NLI audit outcome; pack is append-only and pinned by the verdict version (docs/design/STORE.md). |
| Abstention | claims below the confidence threshold publish as open questions, not verdicts (ADR-0001/0004) — abstention is a measured capability, not a failure. |

### 2.7 The NLI publication gate (the accuracy gate)

Per ADR-0006 (CLEF 2026 pattern): **every justification sentence in the evidence pack must be entailed by its cited evidence before publication** — the audit runs before the verdict can publish, not as a sampled retrospective check (that exists separately for mutations, ADR-0002).

- The audit is an NLI pass over (justification sentence, cited evidence span) pairs, schema-constrained via AI SDK `generateObject`; any non-entailed sentence blocks publication and routes the pack to the review queue.
- The audit checks attribution discipline too: no unattributed synthesis; arithmetic and rounding stated explicitly (AVeriTeC annotation protocol adopted for justifications, ADR-0010 lesson 3).
- Audit failure rate is a Grafana page-level metric (ADR-0012: "NLI audit failure rate — justification-hallucination rate; anything above noise pages a human").
- Known limitation, stated honestly: the auditor is itself an LLM. The harness calibrates the auditor (fixture packs that must pass and must fail at L1; audit-agreement measured on the labelled set at L3) — the audit is a gate on the worst hallucinations, not proof of entailment.
- Models per role are ADR-0011's routing table, harness-gated; prompts are versioned files in `packages/llm/prompts` (CROSS-CUTTING §3); verdict adjudication is batch-routed by default with realtime escalation for publish-day high-impact verdicts (`latency_class`, ADR-0011).

## 3. Interfaces and contracts

### 3.1 Inputs from triage

| Field | Contract |
|---|---|
| claim record | text (normalised utterance), type (routes the mode), fingerprint, embedding, publication_id / segment_id FKs |
| discourse context | window (verbatim), typed optional fields `speech_context` / `policy_topic` / `attached_proposal` / `argument_direction` / `context_qualifiers` — all nullable, never defaulted (ADR-0008); the engine treats absent as absent |
| media fields | `media_anchor`, `transcript_tier`, `caption_quality_flag`, cue span (quote-fidelity mode) |
| dedupe inputs | fingerprint matches into the evidence store (resume-retrieval fast path) |
| explicitly absent | claimant identity, party, reliability profile (ADR-0005 firewall), label data (blind rule, CROSS-CUTTING §8) |

### 3.2 Outputs to the store

| Object | Contract |
|---|---|
| `verdict_version` (v1) | four AVeriTeC classes + pledge/conditional (ADR-0004), confidence, status DRAFT→PUBLISHED; below-threshold claims publish as open questions |
| `evidence_pack` | items + grid computation result + justifications + NLI audit outcome; append-only; pinned by the verdict version |
| `evidence_item` | authority source ref, series/document identity, `vintage_date`, URL, `archive_snapshot_url`, content hash, version — one row per fetched version, never an update |
| `verdict_provenance` | pipeline_version, prompt_versions (per stage), model_versions, search-provider refs, cost/latency span refs — rendered as the site's provenance block |
| `fallback_log` | per-lane Tier-2 fallback events with stage + reason |
| open-question record | below-threshold claims with the evidence pack attached, inviting contest (ADR-0001) |

### 3.3 Contract with search APIs (ADR-0011)

- **Providers**: Brave Search API (primary; Goggles map onto T1–T6 authority-restricted retrieval) + Serper (fallback/bulk). Which is primary is routing config, not code (see §6 Q1).
- **Query-level control** is the requirement: black-box grounding (Gemini-native) is rejected because evidence-pack reproducibility needs query-level control for the grid and authority-restricted retrieval (ADR-0011 alternatives).
- Every search call is cost- and latency-telemetered via gen_ai spans; queries and results (URLs, not full payloads) are recorded on the evidence pack so a verdict's retrieval path is auditable and re-runnable.
- Result drift between runs is a known irreducible noise source (HARNESS §6 Q5); the harness quantifies it rather than hiding it.

### 3.4 Contract with official series

- Series fetched from the authority map (SOURCE-TAXONOMY Part 2) with declared primary authority, alternates, and denominator family per domain; series IDs, vintages, and revision policy are per-domain config.
- **Precedence rule** (methodology-published): T1 > T2 > T3 > T4 > T5 > T6 — but the conflict is often the finding: verdicts cite the claim's own tier first, then the higher-precedence authority; the verdict is about the gap. Advocacy-produced data (T6-at-best) never enters as evidence (ADR-0018).
- Vintage discipline: every series row carries `vintage_date`; verdicts note "as measured at publication"; nightly re-verification (post-slice) detects official revisions against pinned vintages (EVALUATION §7).
- Claims citing sources outside the map fall back to the open-web loop with an explicit no-pre-vetted-authority note (SOURCE-TAXONOMY §2.2).

## 4. Test risks

| ID | Risk | Where it lives | Consequence if untested | Detection signal |
|---|---|---|---|---|
| VER-R1 | Grid arithmetic errors — wrong denominator, stale vintage, wrong baseline produce a confidently wrong number in the grid result | §2.2 grid computation; vintage selection | The flagship mode publishes authoritative-looking wrong arithmetic; "accurate but incomplete" verdicts rest on miscomputed alternatives | L1 exhaustive fixture arithmetic (golden expected grids per fixture series); vintage≠retrieved_at assertion; cross-check of grid rows against independently computed SQL on the same fixture |
| VER-R2 | NLI audit false-passes — unjustified verdicts publish because the auditor misses non-entailed justification sentences | §2.7 audit | The accuracy gate is theatre; justification hallucinations reach the public verdict page | Must-pass/must-fail fixture packs at L1; audit-vs-human-label agreement on the labelled set at L3; audit failure-rate metric going to zero (implausibly perfect) |
| VER-R3 | Retrieval failure/quality — the AVeriTeC bottleneck (gold evidence improves accuracy 14–22 pts); loop retrieves weak or wrong evidence and verdicts degrade | §2.5a open-web loop; retrieval seeds in all modes | The least-reliable mode silently sets the system's accuracy ceiling; per-stratum numbers uninterpretable | L3 per-stratum accuracy (open-web stratum); EV2R development score trend; retrieval-depth-cap-binding rate; AVeriTeC Layer-1 position vs published field |
| VER-R4 | Claim-vs-source comparison errors in citation mode — extraction misses the number/period/population, or the check over-binds (decorative citation treated as load-bearing) | §2.3 citation check | Institution claims get false Supported/Refuted verdicts against sources that don't say what was extracted — the mode whose reliability advantage is the design's premise fails silently | L1 fixture documents with known claim/source pairs (match, number-mismatch, period-mismatch, decorative-citation); L3 citation-check stratum (n=20 gate) |
| VER-R5 | Quote fidelity vs ASR captions — homophones, punctuation, segmentation, number formatting, te reo passages: the mode judges caption text, not audio, and mis-reads ASR artefacts as quote errors (or as fidelity) | §2.4 quote-fidelity mode | Broadcast verdicts assert wording differences that are caption artefacts, or pass misquotes the caption itself carries; "hear it" invites the reader to check and finds an unexplained delta | L1 caption-artefact fixtures (homophone pairs, punctuation variants, number-format variants, macron/te-reo cues) with expected treatments; L3 quote-fidelity stratum (n=25 gate) |
| VER-R6 | Provenance mode over-trusted — least mature mode treated as production infrastructure on the strength of curated-set results | §2.5 | The slice overclaims; the least mature mode fails on live false-context material after being publicly demonstrated as working | Fixture-gate assertions (`is_curated_fixture`, no lane-health registration — ING-R10's engine-side twin); methodology-page posture text asserted at L4 |
| VER-R7 | Prompt/model drift between runs — verdict behaviour shifts without a code change (provider upgrade, prompt edit, temperature/noise) | §2.7 model routing; config tuple | Regression gate compares uncontrolled runs; every accuracy delta arguable; published numbers unreproducible | L2 golden-set snapshot diff per PR (pinned prompts + models); run-manifest completeness test (CROSS-CUTTING §2 tuple); residual-nondeterminism probe (HAR-R7) |
| VER-R8 | Cost blowout — retrieval depth or loop iterations blow the FIRE frontier (~$0.14 LLM + $0.20 search/claim) toward the naive $10+/claim | §2.5a depth capping; §3.3 search usage | The slice's cost/claim deliverable fails; weekly harness runs become unaffordable and the gate goes stale (HAR-R8's sibling) | Cost/claim per stratum in every run file vs the $25/run envelope; depth-cap-binding rate; per-mode cost telemetry (gen_ai spans) with anomaly alert |
| VER-R9 | Evidence-fetch failures degrade verdicts silently — fetch fails, engine falls back to weaker evidence or open-web, verdict publishes with lower-quality grounding and no visible flag | §2.2/§2.3 fetch paths; §2.6 pack assembly | "As measured at publication" claims rest on evidence that was never actually fetched; contestation exposes it publicly | Pack schema assertion: every pack item resolved or explicitly flagged degraded; degraded-grounds rate metric; verdict pages render degradation (L4) |
| VER-R10 | Materiality-selection drift — the LLM selects the wrong grid rows as material to the deployment (framing assessment wrong even when arithmetic is right) | §2.2 step 4; ADR-0008 context fields | "Accurate but incomplete" verdicts mis-aimed: cherry-picking missed, or material omissions asserted where the deployment doesn't support them | L2 golden fixtures with hand-labelled material rows per deployment context; L3 Conflicting/Cherry-picking oversample (≥12 labels, HARNESS §2.2) |
| VER-R11 | Verdict-class boundary errors — true-but-selective labelled Refuted (over-refutation, the AVeriTeC-skew failure mode), or selective framing published as Supported | §2.2 verdict step | The flagship class ("accurate but incomplete") mis-fires in both directions; calibration and the Supported-heavy corrective claim break | L3 calibration table + verdict-mix vs stratum targets; L1 boundary fixtures (true-but-selective → Conflicting; number-matches-no-row → Refuted) |
| VER-R12 | Confidence miscalibration — high confidence on thin evidence; below-threshold claims published as verdicts instead of open questions | §2.6 abstention; adjudication routing | ADR-0001's open-question posture hollows out; abstention quality (a measured capability) unmeasured | L3 calibration table (confidence band vs accuracy); L1 threshold-behaviour fixtures; L4 assertion that open-question claims render as open questions |
| VER-R13 | Fingerprint extraction errors at verification time — engine reads the wrong window/baseline/unit out of a claim the triage fingerprint captured correctly, or vice versa | §2.2 step 1; mode routing input | Grid computed on the wrong indicator×window — verdict answers a question nobody asked; resume-retrieval matches the wrong series | L1 fingerprint→grid-parameter round-trip fixtures; L2 pinned claims spanning fingerprint edge cases (endpoint phrasing, unit words) |
| VER-R14 | Authority-map misuse — claim checked against the wrong tier's series, or advocacy/institutional data used as evidence | §3.4; authority-map config | Verification bias (the claim judged with the wrong baseline); ADR-0018's claim-source-never-evidence guardrail broken in code | L1 authority-map resolution tests per domain (crime→policedata.nz+NZCVS; child poverty → three measures); assertion that T6/advocacy sources are rejected as verdict bases |
| VER-R15 | Routing misclassification — a statistical claim typed "other" gets the open-web loop (loses the grid); an institution claim skips citation-check | §2.1 router | Claims land in the least reliable mode by accident; per-stratum numbers attribute mode failures to the wrong machinery | L1 router fixtures over claim-type × text patterns; L3 lane×mode cross-tab (advisory dimension) exposing systematic misrouting |

## 5. Test strategy

Every §4 risk maps to a test layer per docs/TEST-STRATEGY.md §2 (L1 deterministic/every push; L2 golden-set snapshots/every PR; L3 accuracy harness/weekly + pre-release; L4 site/every push + pre-release). The engine's deterministic surface is large and cheap to test; its LLM surface is gated by golden snapshots and the harness.

| Risk | Mitigation | Layer | When it runs |
|---|---|---|---|
| VER-R1 | **Stat-grid arithmetic on fixture series is pure logic — exhaustive L1 coverage expected.** Fixture official series (synthetic + real snapshots with pinned vintages) per domain; golden expected grid per fixture: every axis (window variants incl. endpoint tricks, per-capita, denominator family, cohorts, seasonality) × every verdict outcome. Vintage-selection tests (stale vintage → wrong baseline asserted as failure). Independent-recomputation cross-check: grid results recomputed via typed SQL over the same fixture and compared | L1 | Every push |
| VER-R2 | L1: fixture evidence packs that must pass and must fail the audit (unattributed synthesis, arithmetic without statement, authority-by-citation, hallucinated sentence). L3: audit agreement measured against human labels on the labelled set; audit false-pass rate reported per run. Grafana audit-failure-rate metric with noise-band alert | L1 + L3 | Every push; weekly + pre-release |
| VER-R3 | AVeriTeC Layer-1 run as the generic-loop regression gate from week 1 (ADR-0010); open-web stratum in the L3 gate (n=25); retrieval telemetry (depth-cap binding, store-hit vs fresh-retrieval ratio, EV2R development score) trended per run. Retrieval-failure fixtures at L1: dead URL, bot-wall 200, empty result set → capped-degraded outcome asserted, never a silent weak verdict | L1 + L3 | Every push; weekly + pre-release |
| VER-R4 | L1 fixture corpus: cited document + claim pairs covering exact match, number mismatch, period mismatch, population mismatch, decorative citation, paywalled/partial document. Each asserts the expected verdict class and binding strictness. High-impact-claim escalation path (Fable-class re-check per ADR-0011) asserted as config, not code | L1 + L3 | Every push; weekly + pre-release (citation stratum gated at n=20) |
| VER-R5 | L1 caption-artefact fixtures: homophone pairs, punctuation/segmentation variants, number-format variants, macron/te reo passages — each with the expected fidelity treatment (flag, limited-verification, or pass). media_anchor construction tests (cue span → padded window → deep-link shape). L3 quote-fidelity stratum (n=25, gated) measures real ASR behaviour on 1News/Q+A captions | L1 + L3 | Every push; weekly + pre-release |
| VER-R6 | L1: provenance mode runs only on fixture-gated records (`is_curated_fixture=true`); test asserts no live-lane registration and no scheduler entry. L4a: methodology page asserts the provenance-mode posture text (demonstration only) is present and no production-readiness claim renders | L1 + L4a | Every push |
| VER-R7 | L2 golden set (~20 pinned claims spanning all modes, pinned prompt + model versions, TEST-STRATEGY §2): snapshot verdict + confidence + evidence path + justifications per PR; any drift is a visible diff the reviewer reads. Run-manifest completeness (CROSS-CUTTING §2 tuple) asserted at L1; ADR-0011 re-run rule on any model-version change | L2 (+L1 manifest test) | Every PR; every push (manifest) |
| VER-R8 | L1: depth-cap bounds tests per mode (FIRE-pattern caps asserted); pre-run cost projection blocks over-budget runs (CROSS-CUTTING §11). L3: cost/claim per stratum in every run file; CI warning past the $25 envelope, fail at 2× | L1 + L3 | Every push; weekly + pre-release |
| VER-R9 | L1: fetch-failure fixtures per mode assert degraded outcome is flagged on the pack and verdict (no silent fallback); pack schema forbids unflagged missing items. L4: verdict pages render the degradation note where flagged | L1 + L4a | Every push |
| VER-R10 | L2 golden fixtures carry hand-labelled material-row expectations per deployment context (with/without `attached_proposal`); snapshot diff exposes materiality drift. L3: the Conflicting/Cherry-picking oversample (≥12 labels in the stat stratum) is the measured check | L2 + L3 | Every PR; weekly + pre-release |
| VER-R11 | L1: class-boundary fixtures (true-but-selective → Conflicting; number-matches-no-row → Refuted; thin evidence → NEI). L3: verdict-mix vs targets reported; calibration table catches systematic over-refutation (the AVeriTeC-skew failure ADR-0010 names) | L1 + L3 | Every push; weekly + pre-release |
| VER-R12 | L1: threshold-behaviour fixtures (below-threshold adjudication → open-question record, never a verdict class). L3: calibration table published per run (confidence band vs accuracy); abstention quality reported on both layers | L1 + L3 | Every push; weekly + pre-release |
| VER-R13 | L1 round-trip fixtures: claim text (endpoint phrasing, unit words, baseline phrasings) → fingerprint → grid parameters; mismatches asserted as failures. L2 pinned claims cover fingerprint edge cases so drift shows per PR (STO-R12's twin) | L1 + L2 | Every push / every PR |
| VER-R14 | L1: authority-map resolution tests per seeded domain (crime, economy, employment, immigration, housing, health, education, welfare — SOURCE-TAXONOMY §2.2 v1 set): claim domain → correct primary authority + denominator family; advocacy-source rejection asserted (institution document refused as verdict basis) | L1 | Every push |
| VER-R15 | L1 router tests: claim-type × text-pattern fixtures assert correct mode; store records the routing decision for L3 cross-tabbing. L3: lane×mode cross-tab (advisory) exposes systematic misrouting | L1 + L3 | Every push; weekly + pre-release |
| All modes (behavioural) | Golden-set snapshots include ≥1 pinned claim per mode; a verification change that alters verdict behaviour produces a visible snapshot diff, not merely "tests pass" | L2 | Every PR |
| Per-stratum accuracy (the deliverable) | L3 harness produces the accuracy table per media type × verification mode (VALIDATION-SLICE): stat-engine on official prose, quote-fidelity on Tier-2 captions, citation-check on institutional claims, open-web on the catch-all, provenance advisory on the curated set — with calibration + cost/claim per stratum; gate blocks per HARNESS §2.6 (−5 pts gated strata, −3 overall) | L3 | Weekly + pre-release |
| Site rendering of engine outputs | "As deployed" tag, alternatives table, "hear it / watch it" anchors, degraded-evidence flags, methodology accuracy table rendered from the harness file (never hand-edited) | L4 | Every push (L4a) / pre-release (L4b) |

**L1 fixture set (verification-engine surface):** fixture official series with pinned vintages per domain; golden expected grids; class-boundary claim fixtures; cited-document corpus (match/mismatch/decorative/paywalled); caption-artefact fixtures; authority-map resolution fixtures; fetch-failure modes (dead URL, bot wall, partial page); must-pass/must-fail NLI packs; routing fixtures; depth-cap bound cases. All LLM calls mocked at L1.

## 6. Open questions

| # | Question | Notes |
|---|---|---|
| 1 | ~~Search-provider order~~ **Resolved during the coherence pass**: ADR-0014's stack section said "Serper primary (ADR-0011 unchanged)", contradicting ADR-0011's provider table (Brave primary + Serper fallback/bulk). ADR-0011 governs provider selection and has been re-affirmed in ADR-0014 with an inline correction note — Brave primary (T1–T6 authority restriction via Goggles), Serper fallback/bulk. Per-query routing nuance (authority-restricted queries → Brave, bulk → Serper) remains available to `search_config` | Resolved — blocks nothing; `search_config` may finalise per ADR-0011 |
| 2 | Materiality-selection rubric sign-off — ADR-0005 requires "grid rubric sign-off before campaign peak" as a build item. What is the artefact, who signs off, and does the signed rubric become part of `grid_axes_version` (forcing an L3 re-run on change)? | The "you invented the standard" defence depends on this being pre-declared and auditable |
| 3 | Quote-fidelity tolerance policy — when caption wording differs from the claim's quoted wording (homophone, punctuation, number formatting): what delta flips the verdict vs triggers the caption-quality note + "limited to the quoted claim" treatment? Needs a listen-test policy against real Tier-2 items, not a guessed threshold | Directly conditions VER-R5's L1 fixture expectations |
| 4 | Provenance-mode graduation criteria — the curated set is demonstration-only; what measured result (per-stratum accuracy on the fixtures, and on what future labelled set) would justify live false-context handling, and who decides? | Pairs with HARNESS §6 Q7 (real provenance stratum) |
| 5 | NLI-auditor calibration bar — what audit false-pass rate on the labelled set disqualifies the auditor model (and routes to a stronger ADR-0011 role)? The audit is LLM-as-judge; its own harness gate needs a number | Deferred until two L3 runs produce audit-agreement data, like HARNESS §6 Q3 |
| 6 | Depth-cap values per mode — the FIRE pattern fixes the mechanism (confidence-capped), not our numbers. Caps need calibration against cost/claim per stratum from the first L3 runs | Cost envelope ($25/run) bounds the search space |
| 7 | Stat-mode verdict for misquoted-but-real numbers — a claim misquoting a real series (right indicator, wrong figure) routes to Refuted by the no-grid-row-match rule; confirm this boundary holds for rounding/precision variants ("about 30%" vs 27.3%) or whether a tolerance band is needed | Class-boundary arithmetic; interacts with VER-R11 fixtures |