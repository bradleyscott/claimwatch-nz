# ADR-0007: LLM and search provider selection — accuracy-dominant, tiered by task

*Status: Open (recommendations recorded, final decision gated on harness results) · Date: 2026-09-07 · Deciders: Bradley, Dave*

## Context

The pipeline uses paid model APIs and a web-search API. The selection principle: **accuracy of assessment is paramount** — there is no constraint against open-weights models, and equally no mandate to avoid commercial frontier models if affordable. Model choice per task is governed by measured performance on *our* harness, not by benchmark folklore. Cost matters, but only relative to accuracy: a wrong verdict during an election costs more than any API bill.

### The model landscape as of September 2026 (fresh releases)

All three major labs shipped new flagships in a two-week window immediately before this ADR:

| Model | $ in / $ out (per 1M) | Released | Notes |
|---|---|---|---|
| **Claude Fable 5.1** (Anthropic) | 10.00 / 50.00 (cache-read $0.25 — 75% off) | **Sep 1, 2026** | Anthropic's strongest; strong agentic/knowledge-work gains |
| **Claude Opus 5** (Anthropic) | 5.00 / 25.00 | Jul 24, 2026 | Pre-Fable flagship; still current for most roles |
| **Claude Sonnet 5** (Anthropic) | 2.00 / 10.00 (intro pricing made permanent Aug 10) | Jun 30, 2026 | Near-Opus capability at mid price |
| **GPT-5.6 Sol / Terra / Luna** (OpenAI) | 4.00/20.00 (promo to Nov 21) · 2.00/12.00 · 0.20/1.20 | Jul 9, 2026 | Sol promo ≈20% off; Terra cut 20% Jul 30; Luna cut 80% |
| **Gemini 3.8 Flash** (Google) | 0.75 / 3.75 (promo through Dec 31, 2026; $1.50/$7.50 from Jan 1, 2027) | **Sep 2, 2026** | Best HLE-Verified (54.9%) of any model — *ahead of Opus 5 and Sol*; strong finance/legal agent benchmarks (Valso Finance 61.4%, Harvey Legal 10.0% — both ahead of Opus 5); #1 CharXiv chart reasoning |
| **Gemini 3.7 Flash** (Google) | ~0.75 / 3.75-class (promo) | Aug 13, 2026 | Prior Flash; 3.8 supersedes |
| **Kimi K3** (Moonshot — via non-Chinese operators: Fireworks, OpenRouter, DeepInfra) | 3.00 / 15.00 (cache-hit $0.30) | Jul 16, 2026 (open weights, custom licence) | 1M context; Intelligence Index #5, LCR #2; multimodal |
| **GLM-5.3 / 5.3-Flash** (Z.ai, via aggregators) | 1.40 / 4.40 (cache $0.26); Flash $0.15 / $0.50 (cache $0.03) — third-party rates; no published Z.ai rate (coding-plan-gated at launch) | Aug 14, 2026 | Open weights; strong agentic/coding benchmarks |
| **DeepSeek V4 Flash** | 0.14 / 0.28 | 2026 | Cheapest; **origin-operator API excluded during the election cycle** (foreign-hosted rule); non-Chinese operators serving these weights permitted |

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
| **Kimi K3 (Moonshot)** | 3.00 / 15.00 (cache-hit input $0.30) | 1M context; open weights (custom licence, not MIT); Intelligence Index #5, LCR #2; **non-Chinese third-party hosting available (Fireworks, Together, DeepInfra — US/EU operators)** |
| **GLM-5.3 (Z.ai/Zhipu)** | 1.40 / 4.40 (cache-hit $0.26) per third-party aggregators; no published rate on Z.ai's own card (coding-plan-gated at launch) | Open weights; strong agentic/coding benchmarks; GLM-5.3-Flash at $0.15/$0.50 is an extreme-value agent tier |
| DeepSeek V4 Flash | 0.14 / 0.28 | Cheapest, but **origin-operator API excluded during the election cycle** (foreign-hosted inference rule, ADR-0007); non-Chinese operators serving DeepSeek weights are permitted |
| MiniMax M3, GLM-5.2, Qwen3.7 Flash | 0.03–1.40 / 0.13–4.40 | Open-weight/routeable; strong on some benchmarks |

**Hallucination/calibration evidence (the property that matters most here):** on AA-Omniscience, Claude models lead decisively at refusing unanswerable questions (Claude 4.1 Opus: 0% hallucination on refused items; Opus-class ~36% attempting-at-scale vs GPT-5.5's ~50 points worse); on Vectara's updated dataset GPT-5.5-class and Claude Haiku 4.5 tie (~9–10%); Gemini Flash variants show the lowest hallucination on document-based tasks. **Pattern: Claude for abstention/verdict roles, Gemini Flash for bulk document work, both defensible on evidence.** (Benchmark variance is high; our own harness is the arbiter — see decision rule.)

**Search APIs:** Brave $5/1k calls (+$5 monthly free credits; AI-optimised endpoint; **Goggles domain-reranking** — directly useful for authority-restricted retrieval in topic-pack mode); Serper ~$0.30–1.00/1k (cheapest SERP); Exa $5/1k + page charges; Tavily $8/1k; Gemini-with-grounding $14/1k + tokens (black-box query control — poor fit; we need to control queries for evidence-pack reproducibility).

## Decision (framework + recommendation; final gate = harness)

**Selection rule:** models are chosen per pipeline role by measured performance on our labelled harness (`docs/EVALUATION.md`) — accuracy-dominant, then price. The harness gates model choice the same way it gates prompt changes. No model is adopted because a benchmark paper liked it.

**Recommended routing (to be confirmed by harness runs before launch; current September-2026 pricing):**

| Role | Recommended model | Rationale | Pricing (in/out per 1M) |
|---|---|---|---|
| Verdict adjudication + confidence | **Claude Fable 5.1** (Sep 1, 2026) — Opus 5 as fallback | Anthropic's strongest; cache-read now $0.25/M (75% off Fable 5), and cached input dominates our context-heavy evidence packs — the effective cost gap to Opus narrows sharply in batch | $10.00 / $50.00 |
| Second-opinion pass on high-impact verdicts | **GPT-5.6 Sol** (promo $4/$20 to Nov 21, 2026) | Cross-family agreement as a confidence signal; disagreement → lower confidence + visible flag | $4.00 / $20.00 (promo) |
| Citation check (claim vs source) | **Claude Sonnet 5** ($2/$10, intro pricing permanent) | Extraction precision at mid price; upgrade to Fable 5.1 for high-impact claims | $2.00 / $10.00 |
| Fingerprint extraction / triage / typing | **Gemini 3.8 Flash** ($0.75/$3.75 promo through Dec 31, 2026) — released Sep 2 | Best HLE-Verified of any model (54.9%, ahead of Fable/Opus/Sol); #1 CharXiv chart reasoning; 1M context | $0.75 / $3.75 |
| Justification drafting | **GLM-5.3-Flash** ($0.075/$0.25 via OpenRouter; $0.15/$0.50 direct) or **Gemini 3.8 Flash** | Extreme-value tier; harness decides which passes attribution discipline | $0.075 / $0.25 |
| Repeat-claim matching / embeddings | **Gemini 3.8 Flash** or an embedding model via Fireworks (batch 50% off) | Batch-shaped workload | ~$0.001–0.01 |
| Search | **Brave Search API** (primary; Goggles for authority-restricted retrieval) + **Serper** (fallback/bulk) | Predictable pricing, free monthly credits, domain-reranking maps onto T1–T6 authority restriction | ~$0.005–0.05/query |

**Model pricing table (September 2026, researched — see model landscape above for release dates):**

| Model | $ in / $ out (per 1M) | Notes |
|---|---|---|
| Claude Fable 5.1 (Anthropic) | 10.00 / 50.00 (cache-read $0.25) | Strongest Anthropic model; strong agentic/knowledge-work gains over Fable 5 |
| Claude Opus 5 (Anthropic) | 5.00 / 25.00 | Pre-Fable flagship; still current for most roles |
| Claude Sonnet 5 (Anthropic) | 2.00 / 10.00 (intro made permanent Aug 10) | Near-Opus capability at mid price |
| GPT-5.6 Sol / Terra / Luna (OpenAI) | 4.00/20.00 (promo to Nov 21) · 2.00/12.00 · 0.20/1.20 | Family spanning flagship → high-throughput |
| Gemini 3.8 Flash (Google) | 0.75 / 3.75 (promo to Dec 31, 2026; $1.50/$7.50 from Jan 1, 2027) | Best HLE-Verified of any model; #1 CharXiv chart reasoning; 1M context; multimodal |
| Gemini 3.7 Flash (Google) | ~0.75 / 3.75-class (promo) | Prior Flash; 3.8 supersedes |
| Kimi K3 (Moonshot — via non-Chinese operators: Fireworks, OpenRouter, DeepInfra) | 3.00 / 15.00 (cache-hit $0.30) | 1M context; open weights (custom licence, not MIT); Intelligence Index #5, LCR #2; multimodal |
| GLM-5.3 / 5.3-Flash (Z.ai, via aggregators) | 1.40 / 4.40 (cache $0.26); Flash $0.075/$0.25 on OpenRouter ($0.15/$0.50 direct) — third-party rates; no published Z.ai rate (coding-plan-gated at launch) | Open weights; strong agentic/coding benchmarks |
| DeepSeek V4 Flash | 0.14 / 0.28 | Cheapest; **origin-operator API excluded during the election cycle** (foreign-hosted rule, ADR-0007); non-Chinese operators serving these weights permitted |

**Volume economics at campaign scale** (~100 claims/day, ~5 search queries/claim): with tiered routing (Gemini 3.8 Flash-class bulk, Fable 5.1/Opus 5 verdicts), total LLM+search spend ≈ **$10–50/day blended** at campaign peak — with batch discounts applied, trending toward the low end. Model choice per role is accuracy-dominant; the tiered routing exists so that accuracy doesn't force premium pricing everywhere, and the harness arbitrates per role.

**Batch / non-realtime processing (50% discount — applies to most of our workload):**

All three major providers offer a **flat 50% discount** on asynchronous batch processing (24-hour SLA; Anthropic reports most batches completing <1 hour in practice; no quality difference — same models, same outputs, different timing):

| Provider | Mechanism | Discount | Practical notes |
|---|---|---|---|
| **Anthropic Message Batches API** | 100k requests/batch, results retained 29 days | 50% in+out, all models | **Caching stacks with batch** (Opus cached input in batch ≈ 95% off list); most batches <1h despite 24h SLA |
| **OpenAI Batch API** | JSONL upload, 50k requests/batch | 50% in+out | **Flex processing** offers the same 50% with full caching support on GPT-5+ models |
| **Gemini Batch API** (Vertex) | GCS/BigQuery-style job | 50% in+out (verify per model — embedding batch is only 20%) | Tightly integrated with GCS; heavier ergonomics |

**Open-weight third-party hosts: batch support confirmed on the providers we'd actually use.** This matters because our open-weights routing (Kimi K3, GLM-5.3, DeepSeek weights via non-Chinese operators) goes through these aggregators, not origin APIs:

| Provider | Batch discount | Notes |
|---|---|---|
| **Fireworks AI** (serves DeepSeek, GLM-5.2, Kimi K2.6-class) | **Flat 50% off serverless in+out for async batch**; cached-input discounts steeper still (DeepSeek V4 Pro cache ≈92% off, GLM 5.2 ≈90% off, Kimi K2.6 ≈83% off) | Batch + cache stack — same lever the big-three offer, on open weights |
| **Together AI** | **50% batch discount** on async workloads | Broadest open-weight catalogue (200+ models); pay-as-you-go |
| **DeepInfra** | No published batch tier — competes on list price instead (typically cheapest per-token on shared models, e.g. Llama 3.3 70B ≈$0.23/$0.40) | Zero-retention inference by default; resells Claude models too (one key reaches open weights + Claude) |
| **OpenRouter** (Kimi K3, GLM-5.3-Flash routable) | No batch tier — per-token with ~5.5% platform fee on pay-as-you-go; routes between providers on price/speed | Use as gateway/fallback, not for batch economics |

**Read-through:** batch discounts are **not** a big-three-only feature — Fireworks and Together match the 50% on the open-weight models we'd route through them. The practical consequence: the batching strategy above applies to the whole routing table, and model choice per role doesn't have to trade batch economics away. Where a provider lacks a batch tier (DeepInfra), its lower list price partially compensates — and it's the natural fallback for realtime-lane work.

**Our workload is batch-shaped by nature** — this is a major cost lever, not an edge case:

- **Naturally batch (route through batch APIs, 50% off):** daily Hansard ingestion + claim extraction; release ingestion and triage; the daily digest; topic-pack pre-computation; **all harness/scoring runs**; evidence-field expansion; repeat-claim embedding jobs; nightly re-verification of temporal claims.
- **Realtime only (interactive, list price):** verdict pages a user is actively viewing, contest-form responsiveness, second-opinion passes on publish-day verdicts, any live-event coverage.
- **Hybrid pattern for the verdict role:** adjudicate overnight in batch at 50% off (most claims come from yesterday's ingestion), with realtime escalation only for high-impact verdicts needing same-day publication. Publish-time pressure is the exception, not the rule.
- **Batch + caching stack** (Anthropic explicitly; Fireworks likewise): topic-pack prompts (large, stable system prompts with the pack contents) hit prompt-cache multipliers inside batch — the topic-pack mode's effective cost drops toward ~5–10% of list for cached input.

**Estimated effect:** of total LLM token spend, ~80–90% is batchable → effective blended discount ≈ 40–45%. Campaign-peak LLM spend drops from the ~$50–150/day range toward **~$10–50/day**. The accuracy-dominant routing above becomes cheaper still, which further removes any cost pressure toward weaker models in verdict roles.

**Design consequence:** the pipeline's job scheduler separates batch-eligible work from realtime work at the queue level (a `latency_class` field on each job: `batch` vs `interactive`); batch routing is configuration, not per-call decisions.

**Open-weights posture:** open-weights models (Kimi K3, GLM-5.3, DeepSeek weights via non-Chinese operators, or self-hosted) are eligible for any role **where the harness shows them meeting the accuracy bar**. They are *not* presumed excluded, and commercial models are not presumed required. Self-hosting on the homelab GPU is viable for the cheapest tier only if harness-validated; **foreign-hosted inference APIs in the verdict/validation path are excluded during the election cycle** — see below.

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

- Cost estimate for the 2026 cycle: ~$2–4K total at the recommended routing; the accuracy-dominant rule is affordable at our volumes.
- The harness becomes load-bearing for procurement, not just quality — it must exist before launch (already required by ADR-0001/0008).
- Provider-version pinning and routing config become first-class pipeline config items.