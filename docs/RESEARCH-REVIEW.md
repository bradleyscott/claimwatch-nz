# Research review: state of the art relevant to ClaimWatch NZ

*Last updated 2026-09-07; summarises background research from Sep 2025 design conversations onward. Sources linked inline; updated as ADR decisions land.*

## 1. Problem statement

A public resource that checks factual claims in NZ political debate ahead of the 2026 election, with a sustainable operating model and no employed editorial staff. The model: **AI-drafted verdicts the public can contest with evidence; validated contest evidence mutates the verdict.**

## 2. The research landscape

### 2.1 Where the field is

Automated fact-checking has converged on a five-stage pipeline (CLEF CheckThat! Lab tasks, 2025–2026): source retrieval → check-worthy claim detection → evidence retrieval → verification → justification generation.

| System | What it is | Relevance |
|---|---|---|
| **OpenFactCheck** ([openfactcheck.com](https://openfactcheck.com)) | Framework for evaluating LLM-output factuality (benchmarks, leaderboards) | Research tool, not a product; value is the evaluation methodology. Superseded by LOKI (same group). |
| **LOKI** ([paper](https://aclanthology.org/2025.coling-demos.4.pdf), COLING 2025) | Open 5-step pipeline: decompose → check-worthiness → query generation → retrieval → verify. ~3 LLM calls + 1 web query/document. | Closest open-source starting point. Multilingual, latency/cost-optimised. |
| **FIRE** ([github.com/mbzuai-nlp/fire](https://github.com/mbzuai-nlp/fire), NAACL 2025) | Agent-style iterative retrieval + verification with dynamic stopping. | The cost frontier: **~$0.14 LLM + $0.20 search/claim** (GPT-4o-mini) vs $10.45 + $1.47 with GPT-4o, comparable F1. The loop we adapt. |
| **SAFE** ([github.com/google-deepmind/long-form-factuality](https://github.com/google-deepmind/long-form-factuality)) | LLM decomposes long text into atomic facts, iteratively searches, rates each. | Decomposition pattern directly reusable (code released; check licence at use). |
| **ClaimBuster** (UT Arlington) | Fine-tuned check-worthiness classifier (~2ms/claim). | Redundant at our scale — the LLM triage pass covers it. Skipped (see ADR-0002). |
| **HerO** ([github.com/ssu-humane/HerO](https://github.com/ssu-humane/HerO)) | 2nd place AVeriTeC 2024; best open-LLM pipeline (question generation → HyDE → rerank → verdict). | Reference architecture. |
| **qraft** ([github.com/mbzuai-nlp/qraft](https://github.com/mbzuai-nlp/qraft), TACL) | LLM generation of full fact-check articles from evidence. | Drafting support for verdict writeups. |
| **Full Fact AI** ([fullfact.ai](https://fullfact.ai)) | Proprietary monitoring: transcription, claim labelling, repeat-claim matching. 45+ orgs, 30 countries, 12 elections. | Considered as a licensed alternative; rejected in ADR-0003. |

### 2.2 Benchmark reality check — how good is automated verification, honestly?

**AVeriTeC** (FEVER workshop; real-world claims verified against the live web) is the de-facto yardstick: 2024 winner (unrestricted, GPT-4o) **63%**; 2025 winner (open weights, single GPU, ≤1 min/claim) **33%**. Cross-benchmark work (2025) found: **retrieval is the primary bottleneck** (gold annotations in place of retrieved evidence lift accuracy 14–22 points), and **system rankings flip across domains**.

**Design consequence (ADR-0001):** automated verdicts are not reliable enough to publish as final during an election. Automation triages, drafts, and assembles evidence; the contest layer plus published accuracy is the credibility mechanism. Also: verification is much more accurate claim-vs-specific-source (citation checking) than claim-vs-open-web — which drives the verification-layer design (ADR-0005).

### 2.3 Community correction: what works and what doesn't

- **X Community Notes** (open bridging algorithm): a 2025 PNAS study of 264K+ posts found notes cut resharing of misleading posts **25–34%**. Bridging (agreement counts more when raters historically disagree) resists partisan brigading.
- **Meta adopted the model in 2025** (ending third-party fact-checking). Known limits: **speed** (most notes arrive after most people have seen the content), **coverage** (few misleading posts ever get one), high consensus bar.
- **Our key difference (ADR-0002):** X/Meta mutate *visibility* of crowd notes via consensus; we mutate *verdicts* via **validated evidence** — submitted sources run the verification pipeline (provenance, authority, corroboration) and only evidence clearing the bar triggers mutation. One well-sourced contest can beat crowd sentiment; brigading floods noise that dies in validation. Closer to Wikipedia's verifiability model than social voting.
- **Cold start:** bridging needs a large active rater pool; not achievable at NZ scale in an 8-week build. v1 contestation is a structured contest + evidence-validation pipeline with human review; bridging-style rating is deferred (ADR-0002).

### 2.4 Statistical claims and cherry-picking

The core design insight: the main value is checking the evidence politicians cite for policy propositions, and the main risk is stats quoted accurately but painting a convenient, incomplete, or skewed picture. Standard AFC handles this poorly because the claim sentence itself is not false. Academic work exists — cherry-picking detection as missing-statement identification (arXiv:2401.05650, 2024; UTA "Filling the Blanks" thesis, 2025) — a live research frontier we would be productising. The mechanism (canonical fingerprint + sensitivity grid over official series, verdict "accurate but incomplete") is specified in ADR-0005.

### 2.5 NZ-specific data and distribution infrastructure

**Open data (verification fuel):**
- **Hansard** — official, open, complete debate transcripts; daily updates; also the source for the labelled evaluation set (`EVALUATION.md` §2.2).
- **Beehive.govt.nz** — ministerial releases + speeches with RSS; primary political source.
- **Stats NZ** — Aotearoa Data Explorer, Infoshare, bulk CSVs (NZ.Stat retired Sep 2024).
- **Figure NZ** — curated chart library across NZ providers, charity-run.
- **Parliament TV** — live + archived; transcription deferred (ADR-0007).
- **Scoop.co.nz** — party/interest-group release aggregator (not machine-accessible; see `COVERAGE.md`).

**Distribution:**
- **ClaimReview / MediaReview** schema.org markup surfaces fact-checks in Google/Bing panels; Google's Fact Check Markup Tool and Data Commons feed are free; Full Fact's WordPress plugin is open source. 130K+ fact-checks were in Fact Check Explorer, seen 4B+ times in Google Search in 2019.
- **News RSS**: NZ Herald and RNZ maintain public indexes (RNZ's are personal-use licensed — fine as claim sources, not for syndication); Stuff feeds live; Beehive has RSS.

### 2.6 Business/operating model landscape

- **Full Fact's model**: charity + trading arm licensing tools; content free, tooling paid; deployments grant-subsidised ($400K McGovern grant; subsidised US newsroom licences ahead of the 2026 midterms). Funding context: Google withdrew £1M+/yr in 2025; Meta's platform payments collapsed sector-wide; Full Fact is seeking expansion partners.
- **Verified-claims dataset licensing**: curated fact-check data has recognised value to AI companies — a post-election revenue path our mutation/audit dataset is well-shaped for.
- **Our model**: build cost is engineering time + ~$2K/mo run cost (LLM + search APIs, trivial hosting). Credibility rests on published accuracy + process transparency, not a masthead — hence the evaluation harness (§3) as a core asset.

## 3. The evaluation harness (the core trust asset)

An automated + community-mutated verdict system has no editorial masthead to borrow trust from; the substitute is **published, reproducible measurement** (full design in `EVALUATION.md`):

- **Ground truth**: claims sampled from historical Hansard (pre-current-cycle), labelled with cited primary sources (operator + one other initially; journalism-school partnership as scale-up path), inter-annotator agreement reported, set published openly and versioned.
- **Blind scoring** against present-day retrievable evidence only, reported per claim type and confidence band, plus calibration.
- **Regression gate**: every pipeline change re-runs the harness; accuracy-reducing changes don't ship.
- **Community-layer grading**: replay historical contest cases; measure whether validated community evidence moves verdicts toward or away from expert labels — the dataset that can answer the question the sector is arguing about, and a genuinely fundable research artefact.

Managed pitfalls: temporal leakage (evidence-availability notes; exclude claims checkable only at a past moment), distribution skew (Hansard claims are easier than live campaign claims — complemented with news-derived claims), overfitting (a held-out slice never tuned against).

Quick-build version for 2026: **100 labelled claims**, 20% double-labelled, scored once before launch, number published with its interval.

## 4. Legal and compliance landscape (details in `LEGAL-COMPLIANCE.md`)

- **Electoral Act 1993 s 199A** (false statements, intent to influence) applies only to material first published on election day or the two preceding days → verdict mutation freeze 5 Nov 2026 until after official results.
- **Election advertising regime**: the Electoral Commission excludes editorial content; a fact-check is best read as editorial, but that characterisation is untested for automated + community-mutated content. Design responses: never solicit votes; visible non-partisanship; promoter statement anyway (offence exposure up to $40K without it).
- **Defamation** (civil, no anti-SLAPP): verdicts address claims, not persons; evidence-first presentation; honest-opinion posture.
- **HDCA 2015**: we are an "online content host" for user content about individuals, with notice-and-takedown duties (Netsafe is the approved agency).
- **Broadcasting Act / Privacy Act / contempt**: minimal exposure; suppression-check flag on court-related claims.

## 5. Open questions (tracked in ADRs)

| ADR | Decision | Status |
|---|---|---|
| 0001 | Automated verdicts published as "open to contest", no per-verdict sign-off | Proposed |
| 0002 | Ingestion scope + contestation mechanism + verdict language + freeze | Proposed |
| 0003 | Build vs license Full Fact tooling | **Decided: build (open)** |
| 0004 | Verdict schema + benchmark alignment | Proposed |
| 0005 | Verification layer (multi-mode) | Proposed |
| 0006 | Ingestion architecture (six lanes, extraction ladder) | Proposed |
| 0007 | Broadcast/podcast scope | Proposed |
| 0008 | Claim context + document hierarchy | Proposed |
| 0009 | Argument chains | Proposed |
| 0010 | Ground-truth evaluation (two-layer) | Proposed |
| 0011 | LLM/search provider selection | Open |
| 0012 | Observability | Proposed |
| 0013 | Public proposal of sources and authorities | Proposed |
| 0014 | Implementation technology | Proposed |
| 0018 | Institutional claim sources | Proposed |

## 6. Source list (primary)

- OpenFactCheck: https://openfactcheck.com / arXiv:2405.05583 / arXiv:2408.11832
- LOKI: https://aclanthology.org/2025.coling-demos.4.pdf
- FIRE: https://arxiv.org/abs/2411.00784 / https://github.com/mbzuai-nlp/fire
- SAFE: https://github.com/google-deepmind/long-form-factuality / arXiv:2403.18802
- AVeriTeC 2024 shared task report: https://arxiv.org/abs/2410.23850
- AVeriTeC 2025 shared task report: https://aclanthology.org/2025.fever-1.15
- Cross-benchmark robustness evaluation: https://www.alphaxiv.org/abs/2608.25934
- CLEF CheckThat! 2026 overview: https://arxiv.org/abs/2602.09516
- Community Notes effect (PNAS 2025): https://www.pnas.org/doi/10.1073/pnas.2503413122
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