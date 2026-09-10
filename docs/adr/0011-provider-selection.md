# ADR-0011: LLM and search provider selection — accuracy-dominant, tiered by task

*Status: Open (recommendations recorded, final decision gated on harness results) · Date: 2026-09-07 · Deciders: Bradley, Dave*

## Context

The pipeline uses paid model APIs and a web-search API. The selection principle: **accuracy of assessment is paramount** — no constraint against open-weights models, and no mandate to avoid commercial frontier models if affordable. Model choice per task is governed by measured performance on *our* harness, not benchmark folklore. Cost matters, but only relative to accuracy: a wrong verdict during an election costs more than any API bill.

### What the tasks require (task-performance analysis)

| Pipeline role | Task character | Critical model property |
|---|---|---|
| **Verdict adjudication** (evidence pack → verdict + confidence) | Reasoning over retrieved evidence; deciding what is *not* established is as important as what is | **Calibration** — the model must reliably refuse "not enough evidence" rather than guess. Hallucination rate on adjudication is the failure mode that kills the project |
| **Claim-vs-source comparison** (citation checking) | Careful reading: does the cited document say what's claimed (numbers, period, population)? | Extraction precision; low hallucination; number fidelity |
| **Fingerprint extraction / claim typing / triage** | High-volume structured extraction over mundane text | Structured-output reliability, cost, speed |
| **Evidence-pack drafting** (justification text) | Summarisation of sourced material with citations | Attribution discipline (no unattributed synthesis), cheap |
| **Contestation validation** | Source authentication reasoning | Same profile as verdict adjudication |

The decisive property for verdict roles is **calibration-awareness — knowing what it doesn't know** — more than raw benchmark score. A model that is 5% "smarter" but guesses when evidence is thin is worse for us than a slightly weaker model that abstains.

## Decision

**Selection rule:** models are chosen per pipeline role by measured performance on our labelled harness (`EVALUATION.md`) — accuracy-dominant, then price. The harness gates model choice the same way it gates prompt changes. No model is adopted because a benchmark paper liked it.

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

**Model pricing (September 2026):**

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
| DeepSeek V4 Flash | 0.14 / 0.28 | Cheapest; **origin-operator API excluded during the election cycle** (foreign-hosted rule, below); non-Chinese operators serving these weights permitted |

**Volume economics at campaign scale** (~100 claims/day, ~5 search queries/claim): with tiered routing (Gemini 3.8 Flash-class bulk, Fable 5.1/Opus 5 verdicts), total LLM+search spend ≈ **$10–50/day blended** at campaign peak, with batch discounts applied trending toward the low end. The tiered routing exists so accuracy doesn't force premium pricing everywhere; the harness arbitrates per role.

### Batch / non-realtime processing (50% discount — applies to most of our workload)

All three major providers offer a **flat 50% discount** on asynchronous batch processing (24-hour SLA; Anthropic reports most batches completing <1 hour in practice; no quality difference — same models, same outputs, different timing):

| Provider | Mechanism | Discount | Practical notes |
|---|---|---|---|
| **Anthropic Message Batches API** | 100k requests/batch, results retained 29 days | 50% in+out, all models | **Caching stacks with batch** (Opus cached input in batch ≈ 95% off list); most batches <1h despite 24h SLA |
| **OpenAI Batch API** | JSONL upload, 50k requests/batch | 50% in+out | **Flex processing** offers the same 50% with full caching support on GPT-5+ models |
| **Gemini Batch API** (Vertex) | GCS/BigQuery-style job | 50% in+out (verify per model — embedding batch is only 20%) | Tightly integrated with GCS; heavier ergonomics |

**Open-weight third-party hosts: batch support confirmed on the providers we'd actually use.** Our open-weights routing (Kimi K3, GLM-5.3, DeepSeek weights via non-Chinese operators) goes through aggregators, not origin APIs:

| Provider | Batch discount | Notes |
|---|---|---|
| **Fireworks AI** (serves DeepSeek, GLM-5.2, Kimi K2.6-class) | **Flat 50% off serverless in+out for async batch**; cached-input discounts steeper still (DeepSeek V4 Pro cache ≈92% off, GLM 5.2 ≈90% off, Kimi K2.6 ≈83% off) | Batch + cache stack — same lever the big-three offer, on open weights |
| **Together AI** | **50% batch discount** on async workloads | Broadest open-weight catalogue (200+ models); pay-as-you-go |
| **DeepInfra** | No published batch tier — competes on list price instead (typically cheapest per-token on shared models, e.g. Llama 3.3 70B ≈$0.23/$0.40) | Zero-retention inference by default; resells Claude models too (one key reaches open weights + Claude) |
| **OpenRouter** (Kimi K3, GLM-5.3-Flash routable) | No batch tier — per-token with ~5.5% platform fee on pay-as-you-go; routes between providers on price/speed | Gateway/fallback, not batch economics |

**Read-through:** batch discounts are not a big-three-only feature — Fireworks and Together match the 50% on the open-weight models we'd route through them, so the batching strategy applies to the whole routing table. Where a provider lacks a batch tier (DeepInfra), its lower list price partially compensates — and it's the natural fallback for realtime-lane work.

**Our workload is batch-shaped by nature** — a major cost lever, not an edge case:

- **Naturally batch (route through batch APIs, 50% off):** daily Hansard ingestion + claim extraction; release ingestion and triage; the daily digest; **all harness/scoring runs**; evidence-field expansion; repeat-claim embedding jobs; nightly re-verification of temporal claims.
- **Realtime only (interactive, list price):** verdict pages a user is actively viewing, contest-form responsiveness, second-opinion passes on publish-day verdicts, any live-event coverage.
- **Hybrid pattern for the verdict role:** adjudicate overnight in batch at 50% off (most claims come from yesterday's ingestion), with realtime escalation only for high-impact verdicts needing same-day publication.
- **Batch + caching stack** (Anthropic explicitly; Fireworks likewise): large stable system prompts hit prompt-cache multipliers inside batch — effective cost drops toward ~5–10% of list for cached input.

**Estimated effect:** ~80–90% of total LLM token spend is batchable → effective blended discount ≈ 40–45%. Campaign-peak LLM spend drops from the ~$50–150/day range toward **~$10–50/day**, further removing any cost pressure toward weaker models in verdict roles.

**Design consequence:** the pipeline's job scheduler separates batch-eligible from realtime work at the queue level (a `latency_class` field on each job: `batch` vs `interactive`); batch routing is configuration, not per-call decisions.

### Open-weights posture

Open-weights models (Kimi K3, GLM-5.3, DeepSeek weights via non-Chinese operators, or self-hosted) are eligible for any role **where the harness shows them meeting the accuracy bar**. They are *not* presumed excluded, and commercial models are not presumed required. Self-hosting on the homelab GPU is viable for the cheapest tier only if harness-validated; **foreign-hosted inference APIs in the verdict/validation path are excluded during the election cycle** — see below.

### Foreign-hosted inference routing

**What is NOT the issue: data protection.** The pipeline sends model APIs only public material — claim text from public sources, retrieved public evidence, public prompts. No sensitive data to leak or retain; provider retention practices are close to irrelevant to harm. A data-protection framing of the exclusion would be dishonest.

**What IS the issue: verdict legitimacy under adversarial framing.** The project's credibility model is auditability — nothing requires hostile framing to survive. An election fact-checker whose verdict path routes through a foreign-operated inference API hands every partisan actor a standing delegitimisation line ("Beijing-operated AI decides what's true in NZ elections"), which lands with particular force in the NZ context (Five Eyes membership, live foreign-interference debates, DPMC's counter-interference apparatus). The attack does not require the model to be biased or retain data — it requires only that the routing is true. A campaign-period liability, not a permanent one.

**The rule (symmetric, principled, time-boxed):**

1. **During the election cycle (through official results, 27 Nov 2026): no foreign-hosted inference APIs in the verdict, second-opinion, or contestation-validation path** — regardless of country. This includes DeepSeek, Kimi (Moonshot), GLM (Zhipu), Qwen (Alibaba) *hosted APIs* equally, and would equally exclude any other country's hosted inference carrying the same legitimacy exposure. US-hosted APIs carry a different (weaker, in NZ context) sovereignty framing; they are permitted, and this asymmetry is acknowledged honestly rather than dressed up as perfect neutrality.
2. **Self-hosted open weights are exempt** — Kimi/GLM/Qwen/MiniMax weights running on NZ-controlled hardware (the homelab GPU) have no foreign operator in the loop and no data egress. For these, the harness is the quality gate — **and the harness includes a bias probe** (the same claims scored across models; systematic partisan-leaning deltas are published per model). Bias probing applies to every model in the routing table, domestic or not.
3. **Non-Chinese providers serving Chinese-created open weights** (Together AI, Fireworks, Groq, OpenRouter serving DeepSeek/Kimi/GLM/Qwen): **permitted**, on the same footing as other US-hosted inference — the rule binds the *inference operator and its jurisdiction*, not the weights' country of origin. Rationale: the delegitimisation vector is a foreign *operator* processing election-truth adjudication, not the model's training provenance. Model-provenance concerns (training-time bias, alignment differences) are handled by the harness bias probe and open disclosure of the routing table, not by hosting rules. **Practical verification requirement:** some aggregators serve the same model both from their own infrastructure *and* as passthrough to the origin provider's API — routing config must record which serving mode is used, and passthrough-to-origin is treated as using the origin operator (excluded under rule 1). Serving mode is verified once at routing-config time and re-verified at the pre-campaign re-probe.
4. **Uniform scope:** foreign-hosted APIs are excluded from *all* pipeline roles during the cycle. The cost difference is negligible at our volumes, and a single rule is easier to defend and audit than a per-role carve-out.
5. **Post-election:** the rule lapses; foreign-hosted APIs become an ordinary procurement question (cost, quality, terms), still subject to harness and bias-probe gates.

**Why not "just disclose it"?** Disclosure doesn't neutralise the attack — it becomes the headline's verification. The freeze-window discipline (ADR-0002) exists because election-period credibility is structurally different from ordinary operation; this rule is the same logic applied to inference provenance.

**Provider-portability constraint (unchanged):** prompts and schemas stay vendor-neutral; routing is configuration, not code.

## Alternatives considered

- **Single-model pipeline** (one model everywhere). Rejected: role requirements differ too much (calibration vs throughput); routing by role is standard 2026 practice and the harness measures per-role anyway.
- **Cheapest-model-everywhere.** Rejected by the accuracy-dominant principle: the verdict role's failure mode (confident wrong answers) is precisely what cheap models are worse at.
- **Gemini native grounding instead of a separate search API.** Rejected: black-box query control breaks evidence-pack reproducibility; we need query-level control for the sensitivity grid and authority-restricted retrieval.
- **Frontier-max-everything (Fable 5.1 / GPT-5.6 Sol at every step).** Rejected on price-performance: 10–50× the cost for roles where mid-tier measurably suffices; reserved for high-impact verdict escalation instead.
- **Batch-everything including verdicts.** Rejected as universal policy: batch is the default for ingestion-side and evaluation workloads, but publish-day high-impact verdicts need the realtime lane; the `latency_class` split keeps both available.

## Decision rule for final selection

1. Build the n=100 harness (ADR-0010) with 2–3 candidate models per role.
2. Score accuracy, calibration (abstention quality), structured-output reliability, cost — publish the matrix.
3. Pick winners per role; re-run the harness on any provider model-version change (the harness pins versions).
4. During the campaign, model-version pinning is strict: no silent provider upgrades; changes go through the harness first.

## Consequences

- Cost estimate for the 2026 cycle: ~$2–4K total at the recommended routing; the accuracy-dominant rule is affordable at our volumes.
- The harness becomes load-bearing for procurement, not just quality — it must exist before launch (already required by ADR-0001/0010).
- Provider-version pinning and routing config become first-class pipeline config items.