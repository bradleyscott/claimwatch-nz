# Decision log (working notes → ADRs)

The running log of the design conversations that produced the ADRs, kept so the *sequence* of reasoning stays visible. ADRs are the stable record; this file is the scratch-pad that shows the path.

## 2025–2026 (pre-repo) — problem shaping

- **Origin**: a public fact-checking resource for the NZ election with a sustainable model. Initially anchored on openfactcheck.com — research showed it to be an LLM-factuality *benchmark*, not a product pattern; LOKI and the FIRE/AVeriTeC ecosystem are the relevant state of the art.
- **Open-source pipelines with paid LLM services** is the pragmatic split (TUDA_MAI won AVeriTeC 2024 on GPT-4o; the open-weights-only 2025 winner scored 33%).
- **Full Fact licensing** examined in depth — viable but incompatible with open-scrutiny goals and NZ-specific flagship needs → ADR-0003.
- **Editorial staffing**: initial plan assumed 2–3 editors; rejected in favour of community-contested automated verdicts with mutation-on-validated-evidence — the project's defining design move.
- **Legal review** identified four exposures (s 199A, advertising characterisation, defamation, HDCA); the mutation freeze and claims-not-persons standard came directly out of it → ADR-0002.
- **Evaluation harness** elevated from nice-to-have to core trust asset when the no-editors model was chosen → ADR-0001, ADR-0010.
- **Statistical claims / cherry-picking** identified by Bradley as the core risk class and value opportunity ("the main thing of value is the evidence politicians claim as the basis for their policy proposals") → ADR-0005 flagship.
- **Quick build for 2026**: 8-week plan cut (releases+Hansard first, LLM triage, FIRE-lite, 100-claim harness, simple contest form, freeze logic). ClaimBuster assessed and skipped at this scale.

## 2026-09-07 — repo created

- Repo initialised: `claimwatch-nz` (working name). Docs written: research review, architecture (4 mermaid diagrams), evaluation, legal-compliance, ADRs 0001–0008. ADR-0003 recorded as the first Decided outcome; ADR-0011 (providers) left Open — needed before pipeline code lands.
- **ADR-0006**: user-submitted URLs/text as a sixth ingestion lane — fetch-from-source rule (never verify from the submission's own rendering; re-retrieve server-side with archive fallbacks), submissions as queue-priority signal, HDCA guardrails shipping with the feature. Proactive social crawling stays deferred.
- **ADR-0006**: paywalled-content policy — no circumvention (TPM/ToS), paywalled content is a claim source not an evidence source, fair-dealing-bounded minimal quotation, claim-origin-paywalled labelling, commercial media-monitoring licences as the post-election option.
- **COVERAGE.md written**: every cited source live-probed. Findings: NZH politics feed silently empty; Scoop not machine-accessible; no party RSS anywhere; no bot challenges. Coverage established as a maintained property.
- **SOURCE-TAXONOMY.md written** (in place of a parked ingestion-architecture ADR): claim-source coverage matrix (anti-bias: ownership, geography, language/culture, format, audience dimensions; monthly audits; wire-dedupe rule) + evidence-authority map (T1–T6 tiers, precedence rule, per-domain authorities with denominator families for 14 policy domains).
- **Second probe round** (per Bradley: probe the not-yet-probed): Newsroom, The Post, The Press, Interest.co.nz have working feeds; ODT serves pages but no feed; Waatea JS-redirects; NZ First + Te Pāti Māori domains wrong/abandoned; 1News JS-rendered, no RSS.
- **SOURCE-TAXONOMY §1.2 revised** (per Bradley): the "Audience/political position" matrix dimension replaced with **"Audience/community served"** — observable descriptors instead of subjective leaning classifications (which would be attackable: "the fact-checkers labelled us X-leaning"). The audit's job is a gap question, answerable from audience descriptors. Verdict criteria remain party-blind (ADR-0002).
- **ADR-0013**: public proposal of claim sources and evidence authorities — two proposal types, one intake (GitHub issue templates pre-launch, site form post-launch), automated scope-check reusing COVERAGE tooling → public maintainer decision record with reasons; tier changes above T4 need subject-matter review. Proposers describe; the project classifies. Domain proposals not accepted. Proposals are consideration, not adoption; provenance labels for community-added entries.
- **MISINFO-TAXONOMY.md written + ADR-0005 revised**: Wardle & Derakhshan disorder types, the seven content types, DISARM/FIMI, and EU-2024 empirical distributions (decontextualisation 59.3% of verified disinformation; fabricated 32.9%; missing-context verdicts 23.4%; electoral integrity top topic at 20.5%). Architecture: technique-aware triage; false-context/provenance as its own mode; the stat engine as one mode of a multi-mode layer; **electoral-process claims the fastest lane** (s 199A interaction); manipulated media out of scope v1 with partner-referral path; imposter content as incident reporting.
- **ADR-0006**: **commentator watchlist** as sixth lane — prominent personalities commenting on politics, reach-based party-blind inclusion via decision record, per-commentator access paths; only factual claims *within* opinion are checked, never the opinion; register frozen during the regulated period.
- **ADR-0011**: selection principle **accuracy of assessment, paramount** — open-weights eligible wherever harness-validated; commercial frontier models welcome when affordable. Sept-2026 landscape: Claude Fable 5.1 recommended for verdict roles on calibration evidence; Gemini Flash / GPT-5.6 Luna / Claude Haiku class for bulk extraction; cross-family second-opinion pass as confidence signal; Brave Search API (Goggles domain-reranking maps onto authority tiers) + Serper fallback. Batch/non-realtime processing is a first-class cost lever.
- **ADR-0010 rewritten as two-layer evaluation**: Layer 1 — AVeriTeC's public dataset (4,568 claims, QA-evidence annotations, public eval script, reference scores 63%/33%) as the immediate benchmark for the generic loop from day one, removing the NZ-set dependency from early pipeline development. Layer 2 — the n=100 NZ-labelled set as the domain calibration set exercising the NZ source ecosystem (the thing AVeriTeC is blind to). Rationale: claim content doesn't need NZ specificity to measure verification skill, but the NZ source ecosystem dimension is real.

## 2026-09-08 — ADR set consolidated and renumbered

- **Retrospective consolidation** (per Bradley: history is not important): 17 chronologically-accumulated ADRs consolidated into **14 records grouped by subject area**. Renumbering applied uniformly; cross-references updated across all docs and diagrams; superseded files removed (git history preserves everything).
- Key consolidations: contestation + verdict language + mutation freeze → ADR-0002; statistical-claim engine + evidence store → ADR-0005; ingestion scope + ingestion architecture → ADR-0006; broadcast interviews + transcription scope boundary → ADR-0007; claim contextualisation + publication/segment hierarchy → ADR-0008. Verdict schema/benchmark alignment split out as ADR-0004.
- Final set: ADR-0001 (automated verdicts as contestable assessments), 0002 (contestation/mutation/language/freeze), 0003 (build open — Decided), 0004 (verdict schema + benchmark alignment), 0005 (verification layer), 0006 (ingestion), 0007 (broadcast/context scope), 0008 (claim context + document hierarchy), 0009 (argument chains), 0010 (ground-truth evaluation), 0011 (provider selection — open, harness-gated), 0012 (observability), 0013 (public proposals), 0014 (implementation technology), 0018 (institutional claim sources).

## Pending decisions (queue for next ADRs)

1. **ADR-0011** — LLM/search providers (blocks pipeline code).
2. **Verdict store + audit-log schema** (append-only design, public changelog format).
3. **Sensitivity grid v0** — the pre-declared alternative-framing grid (draft in `ARCHITECTURE.md` §4; needs formalisation + review).
4. **ClaimReview publisher details** (Google Fact Check Markup Tool vs embedded JSON-LD; likely both).
5. **Site stack** (Next.js vs Astro) and hosting topology on the Proxmox cluster.
6. **Labelling workflow tooling** (even at n=100: double-blind assignment, agreement computation).