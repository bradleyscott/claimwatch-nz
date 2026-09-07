# ADR-0007: LLM and search provider selection — accuracy-dominant, tiered by task

*Status: Open (recommendation recorded, final decision gated on harness results) · Date: 2026-09-07 · Deciders: Bradley, Dave*

## Context

The pipeline uses paid model APIs and a web-search API. The selection principle: **accuracy of assessment is paramount** — there is no constraint against open-weights models, and equally no mandate to avoid commercial frontier models if affordable. Model choice per task is governed by measured performance on *our* harness, not by benchmark folklore. Cost matters, but only relative to accuracy: a wrong verdict during an election costs more than any API bill.

### What the tasks actually require (task-performance analysis)

| Pipeline role | Task character | Critical model property |
|---|---|---|
| **Verdict adjudication** (evidence pack → verdict + confidence) | Reasoning over retrieved evidence; deciding what is *not* established is as important as what is | **Calibration** — the model must reliably refuse "not enough evidence" rather than guess. Hallucination rate on adjudication is the failure mode that kills the project |
| **Claim-vs-source comparison** (citation checking) | Careful reading: does the cited document say what's claimed (numbers, period, population)? | Extraction precision; low hallucination; number fidelity |
| **Fingerprint extraction / claim typing / triage** | High-volume structured extraction over mundane text | Structured-output reliability, cost, speed |
| **Evidence-pack drafting** (justification text) | Summarisation of sourced material with citations | Attribution discipline (no unattributed synthesis), cheap |
| **Contestation validation** | Source authentication reasoning | Same profile as verdict adjudication |

The decisive property for roles 1 and 2 is **calibration-awareness — knowing what it doesn't know** — more than raw benchmark score. A model that is 5% "smarter" but guesses when evidence is thin is worse for us than a slightly weaker model that abstains.

### 2026 landscape findings (researched 2026-09-07)

**Model pricing (per 1M tokens, input/output, list):**

| Model | $ in / $ out | Notes |
|---|---|---|
| Claude Opus 4.8 (Anthropic) | 5.00 / 25.00 | SWE-bench 88.6%, GPQA 93.6%; strongest "knows its limits" profile on hallucination benchmarks |
| Claude Sonnet 5 | 2.00–3.00 / 10–15 | Frontier-adjacent at mid price |
| GPT-5.6 Sol / Terra / Luna (OpenAI) | 5.00/30.00 · 2.50/15.00 · 0.20–1.00/1.20–6.00 | Family spanning flagship → high-throughput |
| Gemini 3.1 Pro (Google) | 2.00 / 12.00 | 1M context; strong scientific reasoning; competitive mid-price |
| Gemini 3.5 Flash (Google) | 1.50 / 9.00 | Cheapest flagship-class US model |
| Claude Haiku 4.5 (Anthropic) | 1.00 / 5.00 | Vectara hallucination 9.8% — ties GPT-5.5 class at a fraction of price |
| DeepSeek V4 Flash | 0.14 / 0.28 | 5–70× cheaper; **data processed in China — disqualifying for this project's optics regardless of quality** |
| MiniMax M3, GLM-5.2, Qwen3.7 Flash | 0.03–1.40 / 0.13–4.40 | Open-weight/routeable; strong on some benchmarks |

**Hallucination/calibration evidence (the property that matters most here):** on AA-Omniscience, Claude models lead decisively at refusing unanswerable questions (Claude 4.1 Opus: 0% hallucination on refused items; Opus-class ~36% attempting-at-scale vs GPT-5.5's ~50 points worse); on Vectara's updated dataset GPT-5.5-class and Claude Haiku 4.5 tie (~9–10%); Gemini Flash variants show the lowest hallucination on document-based tasks. **Pattern: Claude for abstention/verdict roles, Gemini Flash for bulk document work, both defensible on evidence.** (Benchmark variance is high; our own harness is the arbiter — see decision rule.)

**Search APIs:** Brave $5/1k calls (+$5 monthly free credits; AI-optimised endpoint; **Goggles domain-reranking** — directly useful for authority-restricted retrieval in topic-pack mode); Serper ~$0.30–1.00/1k (cheapest SERP); Exa $5/1k + page charges; Tavily $8/1k; Gemini-with-grounding $14/1k + tokens (black-box query control — poor fit; we need to control queries for evidence-pack reproducibility).

## Decision (framework + recommendation; final gate = harness)

**Selection rule:** models are chosen per pipeline role by measured performance on our labelled harness (`docs/EVALUATION.md`) — accuracy-dominant, then price. The harness gates model choice the same way it gates prompt changes. No model is adopted because a benchmark paper liked it.

**Recommended routing (to be confirmed by harness runs before launch):**

| Role | Recommended model | Rationale | Est. cost/claim |
|---|---|---|---|
| Verdict adjudication + confidence | **Claude Opus 4.8** | Best calibration/abstention profile; the role where wrong costs most | ~$0.10–0.30 |
| Second-opinion pass on high-impact verdicts | **GPT-5.6 Sol** (or Sonnet 5) | Cross-family agreement as a confidence signal; disagreement → lower confidence + visible flag | ~$0.05–0.15 |
| Citation check (claim vs source) | **Claude Sonnet 5** | Extraction precision at mid price; upgrade to Opus for high-impact claims | ~$0.02–0.05 |
| Fingerprint extraction / triage / typing | **Gemini 3.5 Flash or GPT-5.6 Luna / Claude Haiku 4.5** | Bulk structured extraction; harness decides which passes the structured-output bar cheapest | ~$0.001–0.01 |
| Justification drafting | Same cheap tier | Attribution-disciplined summarisation | ~$0.005 |
| Search | **Brave Search API** (primary; Goggles for authority-restricted retrieval) + **Serper** (fallback/bulk) | Predictable pricing, free monthly credits, domain-reranking maps onto T1–T6 authority restriction | ~$0.005–0.05/query |

**Volume economics at campaign scale** (~100 claims/day, ~5 search queries/claim): verdict-critical spend ≈ $15–50/day; total LLM+search ≈ $50–150/day at campaign peak. Orders of magnitude inside the business model; accuracy-dominant selection is affordable.

### Batch / non-realtime processing (50% discount — applies to most of our workload)

All three major providers offer a **flat 50% discount** on asynchronous batch processing (24-hour SLA; Anthropic reports most batches completing <1 hour in practice; no quality difference — same models, same outputs, different timing):

| Provider | Mechanism | Discount | Practical notes |
|---|---|---|---|
| **Anthropic Message Batches API** | 100k requests/batch, results retained 29 days | 50% in+out, all models | **Caching stacks with batch** (Opus cached input in batch ≈ 95% off list); most batches <1h despite 24h SLA |
| **OpenAI Batch API** | JSONL upload, 50k requests/batch | 50% in+out | **Flex processing** offers the same 50% with full caching support on GPT-5+ models |
| **Gemini Batch API** (Vertex) | GCS/BigQuery-style job | 50% in+out (verify per model — embedding batch is only 20%) | Tightly integrated with GCS; heavier ergonomics |

**Our workload is batch-shaped by nature** — this is a major cost lever, not an edge case:

- **Naturally batch (route through batch APIs, 50% off):** daily Hansard ingestion + claim extraction; release ingestion and triage; the daily digest; topic-pack pre-computation; **all harness/scoring runs**; evidence-field expansion; repeat-claim embedding jobs; nightly re-verification of temporal claims.
- **Realtime only (interactive, list price):** verdict pages a user is actively viewing, contest-form responsiveness, second-opinion passes on publish-day verdicts, any live-event coverage.
- **Hybrid pattern for the verdict role:** adjudicate overnight in batch at 50% off (most claims come from yesterday's ingestion), with realtime escalation only for high-impact verdicts needing same-day publication. Publish-time pressure is the exception, not the rule.
- **Batch + caching stack** (Anthropic explicitly): topic-pack prompts (large, stable system prompts with the pack contents) hit prompt-cache multipliers inside batch — the topic-pack mode's effective cost drops toward ~5–10% of list for cached input.

**Estimated effect:** of total LLM token spend, ~80–90% is batchable → effective blended discount ≈ 40–45%. Campaign-peak LLM spend drops from the ~$50–150/day range toward **~$10–50/day**. The accuracy-dominant routing above becomes cheaper still, which further removes any cost pressure toward weaker models in verdict roles.

**Design consequence:** the pipeline's job scheduler separates batch-eligible work from realtime work at the queue level (a `latency_class` field on each job: `batch` vs `interactive`); batch routing is configuration, not per-call decisions.

**Open-weights posture:** open-weights models are eligible for any role **where the harness shows them meeting the accuracy bar** — most plausibly bulk triage/extraction (MiniMax/GLM/Qwen/Kimi-class are frontier-adjacent and nearly free self-hosted). They are *not* presumed excluded, and commercial models are not presumed required. Self-hosting on the homelab GPU is viable for the cheapest tier only if harness-validated; **foreign-hosted inference APIs in the verdict/validation path are excluded during the election cycle** — see below.

### Foreign-hosted inference routing

**What is NOT the issue: data protection.** The pipeline sends model APIs only public material — claim text from public sources, retrieved public evidence, public prompts. There is no sensitive data to leak or retain; any provider's retention practices are close to irrelevant to harm. A data-protection framing of the exclusion would be dishonest.

**What IS the issue: verdict legitimacy under adversarial framing.** The project's credibility model is auditability — nothing requires hostile framing to survive. An election fact-checker whose verdict path routes through a foreign-operated inference API hands every partisan actor a standing delegitimisation line ("Beijing-operated AI decides what's true in NZ elections"), which lands with particular force in the NZ context (Five Eyes membership, live foreign-interference debates, DPMC's counter-interference apparatus). The attack does not require the model to be biased or retain data — it requires only that the routing is true. This is a campaign-period liability, not a permanent one.

**The rule (symmetric, principled, time-boxed):**

1. **During the election cycle (through official results, 27 Nov 2026): no foreign-hosted inference APIs in the verdict, second-opinion, or contestation-validation path** — regardless of country. This includes DeepSeek, Kimi (Moonshot), GLM (Zhipu), Qwen (Alibaba) *hosted APIs* equally, and would equally exclude any other country's hosted inference if it carried the same legitimacy exposure. US-hosted APIs carry a different (weaker, in NZ context) sovereignty framing; they are permitted, and this asymmetry is acknowledged honestly rather than dressed up as perfect neutrality.
2. **Self-hosted open weights are exempt** — Kimi/GLM/Qwen/MiniMax weights running on NZ-controlled hardware (the homelab GPU) have no foreign operator in the loop and no data egress. For these, the harness is the quality gate — **and the harness includes a bias probe** (the same claims scored across models; systematic partisan-leaning deltas are published per model). Bias probing applies to every model in the routing table, domestic or not.
3. **Non-Chinese providers serving Chinese-created open weights** (Together AI, Fireworks, Groq, OpenRouter serving DeepSeek/Kimi/GLM/Qwen): **permitted**, on the same footing as other US-hosted inference — the rule binds the *inference operator and its jurisdiction*, not the weights' country of origin. Rationale: the delegitimisation vector is a foreign *operator* processing election-truth adjudication, not the model's training provenance; with a US (or NZ) operator, no foreign state-adjacent entity is in the loop. Model-provenance concerns (training-time bias, alignment differences) are handled by the harness bias probe and open disclosure of the routing table, not by hosting rules. **Practical verification requirement:** some aggregators serve the same model both from their own infrastructure *and* as passthrough to the origin provider's API — routing config must record which serving mode is used, and passthrough-to-origin is treated as using the origin operator (excluded under rule 1). Provider serving-mode is verified once at routing-config time and re-verified at the pre-campaign re-probe.
4. **Uniform scope:** foreign-hosted APIs are excluded from *all* pipeline roles during the cycle. The cost difference is negligible at our volumes, and a single rule is easier to defend and audit than a per-role carve-out.
5. **Post-election:** the rule lapses; foreign-hosted APIs become an ordinary procurement question (cost, quality, terms), still subject to harness and bias-probe gates.

**Why not "just disclose it"?** Disclosure doesn't neutralise the attack — it becomes the headline's verification. The freeze-window discipline (ADR-0006) exists because election-period credibility is structurally different from ordinary operation; this rule is the same logic applied to inference provenance.

**Provider-portability constraint (unchanged):** prompts and schemas stay vendor-neutral; routing is configuration, not code.

## Alternatives considered

- **Single-model pipeline** (one model everywhere). Rejected: role requirements differ too much (calibration vs throughput); routing by role is standard 2026 practice and the harness measures per-role anyway.
- **Cheapest-model-everywhere.** Rejected by the accuracy-dominant principle: the verdict role's failure mode (confident wrong answers) is precisely what cheap models are worse at.
- **Gemini native grounding instead of a separate search API.** Rejected: black-box query control breaks evidence-pack reproducibility; we need query-level control for the sensitivity grid and authority-restricted retrieval.
- **Frontier-max-everything (Fable 5 / GPT-5.6 Sol at every step).** Rejected on price-performance: 10–50× the cost for roles where mid-tier measurably suffices; reserved for high-impact verdict escalation instead.
- **Batch-everything including verdicts.** Rejected as universal policy: batch is the default for ingestion-side and evaluation workloads, but publish-day high-impact verdicts need the realtime lane; the `latency_class` split keeps both available.

## Decision rule for final selection

1. Build the n=100 harness (ADR-0008) with 2–3 candidate models per role.
2. Score accuracy, calibration (abstention quality), structured-output reliability, cost — publish the matrix.
3. Pick winners per role; re-run the harness on any provider model-version change (the harness pins versions).
4. During the campaign, model-version pinning is strict: no silent provider upgrades; changes go through the harness first.

## Consequences

- Cost estimate for the 2026 cycle firms up at ~$2–4K total (well inside budget); the accuracy-dominant rule is affordable at our volumes.
- The harness becomes load-bearing for procurement, not just quality — it must exist before launch (already required by ADR-0001/0008).
- Provider-version pinning and routing config become first-class pipeline config items.