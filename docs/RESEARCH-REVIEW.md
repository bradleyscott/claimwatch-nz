# Research review: state of the art relevant to ClaimWatch NZ

*Last updated: 2026-09-07. This document summarises the background research done between Sep 2025 design conversations and this date. Sources are linked inline. It will be updated as the design decisions in `adr/` are made.*

---

## 1. Problem statement

Build a public resource ahead of the 2026 NZ general election that checks factual claims made in political debate, with a sustainable operating model, without a permanent employed editorial staff. The intended model: **AI-generated initial verdicts that the public can contest with evidence; validated contest evidence mutates the verdict.**

## 2. The research landscape

### 2.1 Where the field is (as of late 2025 / 2026)

Automated fact-checking (AFC) has converged on a five-stage pipeline (the structure used by the CLEF CheckThat! Lab tasks, 2025–2026 editions):

1. **Source retrieval** — collecting the raw stream (transcripts, releases, articles, posts)
2. **Check-worthy claim detection** — deciding what is worth checking
3. **Evidence retrieval** — finding sources that support or refute each claim
4. **Claim verification** — assigning a verdict (supported / refuted / not enough evidence / conflicting)
5. **Justification generation** — producing the human-readable reasoning

Key systems and their statuses:

| System | What it is | Status / relevance |
|---|---|---|
| **OpenFactCheck** ([openfactcheck.com](https://openfactcheck.com)) | Unified framework for *evaluating the factuality of LLM outputs* (benchmarks, leaderboards) | Research tool, not a fact-checking product. Its value to us: methodology for *evaluating* our own pipeline. Superseded in practice by LOKI (same group). |
| **LOKI** ([paper](https://aclanthology.org/2025.coling-demos.4.pdf), COLING 2025) | Open-source 5-step verification pipeline: decompose → check-worthiness → query generation → retrieval → verify. Parallelised to ~3 LLM calls + 1 web query per document. | Closest open-source starting point for the verification pipeline. Multilingual, latency/cost-optimised. |
| **FIRE** ([github.com/mbzuai-nlp/fire](https://github.com/mbzuai-nlp/fire), NAACL 2025) | Agent-style iterative retrieval + verification; dynamically decides when it has enough evidence and stops. | The cost-efficiency frontier. Benchmarked with GPT-4o-mini: **~$0.14 LLM + $0.20 search per claim** vs $10.45 + $1.47 with GPT-4o raw, at comparable F1. This is the core loop we plan to adapt. |
| **SAFE** ([github.com/google-deepmind/long-form-factuality](https://github.com/google-deepmind/long-form-factuality)) | Search-Augmented Factuality Evaluator: LLM decomposes long text into atomic facts, then iteratively searches Google to rate each. | The decomposition pattern is directly reusable; released code (MIT/Apache — check at time of use). |
| **ClaimBuster** (UT Arlington) | Fine-tuned check-worthiness classifier (DistilBERT in production). ~2ms/claim. | Cheap, deterministic pre-filter. At our scale (hundreds–thousands of sentences/day) the LLM triage pass makes it redundant. See ADR-002. |
| **HerO** ([github.com/ssu-humane/HerO](https://github.com/ssu-humane/HerO)) | 2nd place AVeriTeC 2024; best pipeline using only open LLMs. Question generation → HyDE retrieval → rerank → verdict. | Reference architecture; we may borrow structure but run it with paid models. |
| **qraft** ([github.com/mbzuai-nlp/qraft](https://github.com/mbzuai-nlp/qraft), TACL) | LLM generation of full fact-check *articles* from evidence. | Drafting support for verdict writeups. |
| **Full Fact AI** ([fullfact.ai](https://fullfact.ai)) | Proprietary monitoring platform: transcription, claim labelling (fine-tuned BERT), repeat-claim matching. Licensed to 45+ orgs, 30 countries; used across 12 national elections. | The proven business model in this space (charity owns tech, licenses tooling; content free). Considered as a licensed alternative; see ADR-003. |

### 2.2 Benchmark reality check — how good is automated verification, honestly?

The **AVeriTeC** shared task (FEVER workshop, real-world claims verified against the live web) is the de-facto yardstick:

- **2024** (no model restrictions): winner TUDA_MAI scored **63%** — using GPT-4o throughout.
- **2025** (restricted to open-weights models, single GPU, ≤1 min/claim): winner CTU AIC scored **33.17%**.
- Cross-benchmark evaluation work (2025) found: (a) **retrieval is the primary bottleneck** — replacing retrieved evidence with gold annotations improves verdict accuracy by 14–22 points; (b) **system rankings flip across domains** — winners on one dataset underperform simple baselines on another.

**Design consequence (ADR-001):** automated verdicts are *not* reliable enough to publish as final during an election. Automation's role is triage, drafting, and evidence assembly; the community-contestation layer plus published accuracy measurement is the credibility mechanism. Also: verification accuracy is *much* higher when verification is claim-vs-specific-source (citation checking) than claim-vs-open-web — which drives the verification-layer design (§2.4).

### 2.3 Community correction: what works and what doesn't

- **X Community Notes** (open-source bridging algorithm): a 2025 PNAS study of 264K+ posts found notes reduce resharing of misleading posts by **25–34%**. Bridging (agreement counts more when raters historically disagree) resists partisan brigading.
- **Meta's 2025 adoption**: Meta ended its third-party fact-checking program (Jan 2025) and adopted X's open algorithm. The Oversight Board's assessment and academic commentary note the known limits: **speed** (most notes arrive after most people have seen the content), **coverage** (only a small fraction of misleading content ever gets a note), and **consensus threshold being a high bar**.
- **Our key difference** (see ADR-004): X/Meta mutate *visibility* of crowd-written notes via consensus. We mutate *verdicts* via **validated evidence** — a submitted source runs through the verification pipeline (provenance, authority, corroboration checks) and only evidence clearing the bar triggers mutation. One well-sourced contest can win against crowd sentiment; brigading floods noise that dies in validation. This is closer to Wikipedia's verifiability model than to social voting.
- **Cold start**: bridging maths needs a large active rater pool. At NZ scale we cannot replicate X's dynamics; our v1 contestation is a **structured contest + evidence-validation pipeline with human review**, with bridging-style rating deferred to post-election (ADR-005).

### 2.4 Statistical claims and cherry-picking (the primary mode for statistical claims)

The core insight from the design discussions: **the main value is checking the evidence politicians cite for policy propositions, and the main risk is stats quoted accurately but painting a convenient, incomplete, or skewed picture.**

- This claim class ("crime up 30% since 2017" where the number is true but the framing is selective) is the most common persuasive pattern in campaign material, and standard AFC handles it poorly because the *claim sentence itself is not false*.
- Academic work exists: cherry-picking detection as *missing-statement identification* (the "Cherry" paper, arXiv:2401.05650, 2024; UTA "Filling the Blanks" thesis, 2025 — detecting cherry-picking by finding what important context is missing, using cross-bias source comparison). This is a live research frontier we would be productising.
- Our approach (ADR-004): statistical claims have a canonical fingerprint — **indicator × population × geography × time window × baseline × unit** — and cherry-picking lives in the *choices* within that fingerprint. Verification = reconstruct the **full evidence field** around the same indicator from official series (Stats NZ Aotearoa Data Explorer / bulk CSVs, Infoshare, Figure NZ, MoJ, LAWA), then run a **sensitivity grid**: window variants (endpoint-trick detection), raw vs per-capita, denominator family, comparison cohorts, seasonality. Verdict vocabulary: **"accurate" / "accurate but incomplete — material alternatives contradict the impression"**, with the alternatives shown chart-first.
- **Topic packs**: pre-computed evidence fields for the ~20–30 indicators that will dominate the campaign (crime, net migration vs arrivals, health waitlists by measure, housing consents, child poverty's three official measures, emissions, welfare rolls, etc.). Live claims become fingerprint-match + sensitivity check against the pack — fast, high-accuracy, and anchored to re-derivable official data.

### 2.5 NZ-specific data and distribution infrastructure

**Open data (verification fuel):**
- **Hansard** — official, open, historically complete debate transcripts; daily updates; ideal for both monitoring and building the labelled evaluation set (§3).
- **Beehive.govt.nz** — ministerial releases + speeches, with RSS feeds; primary political source.
- **Stats NZ** — Aotearoa Data Explorer, Infoshare (long time series), bulk CSV downloads. NZ.Stat retired Sep 2024.
- **Figure NZ** — curated chart library across NZ providers, charity-run, free.
- **Parliament TV** — live + archived; transcription is possible but deferred (ADR-002).
- Aggregator: **Scoop.co.nz** carries most party/interest-group releases.

**Distribution:**
- **ClaimReview / MediaReview** schema.org markup is the open standard that surfaces fact-checks in Google/Bing search panels. Google's Fact Check Markup Tool + Data Commons feed are free. Full Fact's WordPress ClaimReview plugin is open source. Over 130K fact-checks were in Google Fact Check Explorer, seen 4B+ times in Google Search in 2019.
- **News RSS**: NZ Herald and RNZ maintain public RSS indexes (RNZ's are personal-use licensed — fine as claim sources, not for syndication); Stuff feeds appear live; Beehive has an RSS index.

### 2.6 Business/operating model landscape

- **Full Fact's model**: charity (diverse funding) + trading arm licensing tools. Content free; tooling paid; deployments grant-subsidised ($400K McGovern grant for a 12-month project; subsidised US newsroom licences ahead of the 2026 midterms). Funding context: Google withdrew £1M+/yr in 2025; Meta's platform fact-checking payments collapsed sector-wide — Full Fact is actively seeking expansion partners.
- **Verified-claims dataset licensing**: curated, verified fact-check data has recognised value to AI companies (Full Fact's own analysis) — a post-election revenue path that our mutation/audit dataset is unusually well-shaped for.
- Our model (community-contested, no editorial payroll): build cost is engineering time + ~$2K/mo run cost (LLM + search APIs, trivial hosting). Credibility rests on **published accuracy + process transparency** rather than a masthead — which is why the evaluation harness (§3) is a core asset, not an afterthought.

---

## 3. The evaluation harness (why it is the core trust asset)

An automated + community-mutated verdict system has no editorial masthead to borrow trust from. The substitute is **published, reproducible measurement**:

- **Ground truth set**: sample claims from historical Hansard (pre-current-cycle, so nothing live-controversial), label verdicts with cited primary sources (self + one other labeller initially; journalism-school partnership as a path), measure inter-annotator agreement, publish the set openly with a version policy.
- **Blind scoring**: run the pipeline against the set using only present-day retrievable evidence; report accuracy per claim type and confidence band, plus calibration.
- **Regression gate**: every pipeline change re-runs the harness; changes that reduce accuracy don't ship.
- **Community layer grading**: replay historical contest cases; measure whether validated community evidence moves verdicts toward or away from expert labels. This is the dataset that can actually answer the question the whole sector is arguing about (does community correction improve accuracy?) — a genuinely fundable research artefact.

Known pitfalls, all managed: temporal leakage (label claims with evidence-availability notes; exclude claims checkable only at a past moment), distribution skew (Hansard claims are easier than live campaign claims — complement with news-derived claims), overfitting (hold out a slice, never tuned against).

The quick-build version for the 2026 election cycle: **100 labelled claims**, double-labelled 20%, scored once before launch, number published. See `docs/EVALUATION.md`.

---

## 4. Legal and compliance landscape (summary; details in `docs/LEGAL-COMPLIANCE.md`)

- **Electoral Act 1993 s 199A** (publishing false statements known to be false, to influence voters) applies only to material **first published on election day or the two preceding days** → design response: **verdict mutation freeze from 5 Nov 2026** until after official results (27 Nov).
- **Election advertising regime**: "election advertisement" = material reasonably regarded as encouraging/persuading voters for/against a candidate or party. The Electoral Commission **excludes editorial content** from the definition; a genuine fact-check is best characterised as editorial, but this is untested for automated + community-mutated content. Design responses: never solicit votes; visible non-partisanship; include a promoter statement anyway (offence exposure otherwise: up to $40K).
- **Defamation** (civil, no anti-SLAPP in NZ): verdicts address claims, not persons; evidence-first presentation; honest-opinion posture.
- **Harmful Digital Communications Act 2015**: applies to hosted user content about *individuals*; we are an "online content host" with notice-and-takedown duties (Netsafe is the approved agency). Procedural compliance: notice workflow + records.
- **Broadcasting Act / Privacy Act / contempt**: minimal exposure for this design; a suppression-check flag on court-related claims covers contempt risk.

---

## 5. Open questions (tracked in ADRs)

| # | Decision | Status |
|---|---|---|
| ADR-001 | Human-in-the-loop posture: automated verdicts published as "open to contest" with no per-verdict sign-off | Proposed |
| ADR-002 | Ingestion scope for 2026 cycle (Hansard + releases first; TV transcription deferred) | Proposed |
| ADR-003 | Build vs license Full Fact tooling | Decided: build (open) |
| ADR-004 | Verification architecture: multi-mode layer (stat-fingerprint + topic packs primary for stats; citation-check; false-context; capped open-web loop) | Proposed |
| ADR-005 | Contestation mechanism for v1 (structured contest + validation + human mutation review; bridging deferred) | Proposed |
| ADR-006 | Verdict language standard ("claims, not persons") and mutation freeze | Proposed |
| ADR-007 | LLM/search provider selection | Open |
| ADR-008 | Ground-truth set construction and labelling process | Proposed |

## 6. Source list (primary)

- OpenFactCheck: https://openfactcheck.com / arXiv:2405.05583 / arXiv:2408.11832
- LOKI: https://aclanthology.org/2025.coling-demos.4.pdf
- FIRE: https://arxiv.org/abs/2411.00784 / https://github.com/mbzuai-nlp/fire
- SAFE: https://github.com/google-deepmind/long-form-factuality / arXiv:2403.18802
- AVeriTeC 2024 shared task report: https://arxiv.org/abs/2410.23850
- AVeriTeC 2025 shared task report: https://aclanthology.org/2025.fever-1.15
- Cross-benchmark robustness evaluation: https://www.alphaxiv.org/abs/2608.25934
- CLEF CheckThat! 2026 overview: https://arxiv.org/abs/2602.09516
- Community Notes effect (PNAS 2025): https://www.pnas.org/doi/10.1073/pnas.2503413122 (via PMC12478135)
- Meta "More Speech and Fewer Mistakes" (Jan 2025): https://about.fb.com/news/2025/01/meta-more-speech-fewer-mistakes
- Oversight Board on Meta's Community Notes plans: https://www.oversightboard.com/decision/pao-007g5zuv
- Cherry-picking detection: https://arxiv.org/abs/2401.05650
- Full Fact AI: https://fullfact.org/ai / https://fullfact.ai
- Full Fact funding context (Poynter, 2025): https://www.poynter.org/fact-checking/2025/the-uks-fact-checkers-are-sending-their-ai-to-help-americans-cover-elections
- ClaimReview project: https://www.claimreviewproject.com / Google Fact Check Tools: https://toolbox.google.com/factcheck/about
- NZ electoral law: Electoral Act 1993 (s 199A: https://www.legislation.govt.nz/act/public/1993/87/en/latest/DLM310074.html); Electoral Amendment Act 2025; Electoral Commission guidance: https://elections.nz/guidance-and-rules/advertising-and-campaigning/about-election-advertising
- HDCA 2015: https://www.legislation.govt.nz/act/public/2015/63/en/latest
- NZ free-speech law landscape (The Future of Free Speech, NZ country report): https://futurefreespeech.org/new-zealand
- NZ open data: https://www.stats.govt.nz/large-datasets / https://figure.nz / https://github.com/WikiNewZealand/new-zealand-data