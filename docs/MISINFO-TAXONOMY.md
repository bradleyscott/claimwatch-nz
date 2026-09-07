# Taxonomies of misleading information — and what they mean for the verification architecture

*Status: research input to ADR-0004 (statistical-claim engine). This document surveys the taxonomies of misleading information in the political sphere — much of it developed in the state-actor misinformation context — maps each class to verification approaches, and states what changes in our architecture. Last updated: 2026-09-07.*

---

## 1. The concern, stated precisely

ADR-0004 built a dedicated engine for one class: **statistical claims quoted accurately but framed selectively**. The worry: verification architecture shaped by the class we found easiest to mechanise, not by the distribution of what actually misleads people during elections. If that distribution is dominated by other classes (fabricated content, decontextualisation, imposter media), the flagship engine covers a minority of the problem.

## 2. The taxonomies in the literature

### 2.1 Information disorder (Wardle & Derakhshan) — the base vocabulary

The Council of Europe framework (2017, *Information Disorder: Toward an Interdisciplinary Framework*; Wardle & Derakhshan 2020 update) defines three types by **intent and truthfulness**:

- **Mis-information** — false, but shared without intent to harm (honest error, rumour, satire taken seriously)
- **Dis-information** — deliberately created to deceive and harm
- **Mal-information** — *genuine* information deployed to cause harm (leaks, doxxing, selectively true material)

Plus three lifecycle phases (creation → (re)production → distribution). The framework is policy-canonical — it's the UN/CoE vocabulary, and its distinction matters for us legally: our pipeline cannot and should not adjudicate *intent* (the dis-information vs mis-information boundary); it assesses **content and context**. Verdict pages should avoid "this is disinformation" as a label — that's an intent claim we can't evidence, and it collides with the claims-not-persons standard.

### 2.2 The seven content types (Wardle / First Draft)

Wardle's typology of mis/dis-information content, ordered loosely by intent to deceive:

| # | Type | Definition |
|---|---|---|
| 1 | **Satire/parody** | No intent to harm, but can fool |
| 2 | **False connection** | Headlines, visuals, captions don't support the content (clickbait, mismatched imagery) |
| 3 | **Misleading content** | Misleading *use* of information to frame an issue or individual — cropping, selective quotes, **selective statistics** |
| 4 | **False context** | *Genuine* content shared with false contextual information (wrong date, place, who said it, what it was about) |
| 5 | **Imposter content** | Genuine sources impersonated (fake newsroom brands, fake government notices) |
| 6 | **Manipulated content** | Genuine information/imagery manipulated to deceive (doctored photos, deepfakes) |
| 7 | **Fabricated content** | Wholly false, designed to deceive |

Type 3 is our ADR-0004 class. The concern was whether the other six are real competition — the empirical data says they are.

### 2.3 Empirical distribution: what fact-checkers actually found (EU 2024)

The Elections24Check collaborative (EFCSN, 2024 European Parliament elections) published technique and verdict distributions — the best empirical test of "what actually gets checked":

**Deception technique** (of verified disinformation): **false context / decontextualisation 59.3%**, fabricated content 32.9%, manipulated content (remainder).

**Verdict type**: false 59.4%, **missing context 23.4%**, partly false 5.4%, true 10.4%, satire 0.4%.

**Topics**: electoral integrity 20.5%, migration 12.9% — with political actors' legacy-media disinformation concentrated on immigration (24.3%).

**Read-through for us:** decontextualisation (true content, false when/where/who) is the *dominant* technique by a wide margin; fabricated content second. Selective statistics ("misleading content" type 3) lives inside the 23.4% "missing context" verdict band along with decontextualisation more broadly. **Our stat engine targets a real but minority slice of the missing-context class; false-context detection is the larger sibling we have not yet designed for.**

### 2.4 FIMI / influence-operation frameworks (the state-actor layer)

- **DISARM** (Disinformation Analysis & Risk Management; open source, CC-BY-SA-4.0, DISARM Foundation; merger of AMITT/SP!CE): an ATT&CK-style matrix of **tactics, techniques and procedures (TTPs)** for influence operations, with counters; adopted by EU and US analysis communities; every framework update adds real-world observed behaviours.
- Adjacent frameworks: ALERT, ABCDE (Pamment, EU), CMU BEND, SCOTCH; Carnegie's evidence-based counter-disinformation policy guide (2024) surveys what interventions actually work.
- **Hack-and-leak** and **newsroom impersonation** are recurrent state-actor patterns (Carnegie; EDMO's 2024/25 election lessons: "newsroom brands are being impersonated, their authority hijacked").

**Read-through:** DISARM is the right vocabulary for *campaign-level* behaviour (coordination, amplification, impersonation infrastructure) — which is not our product, but is our **contestation-layer threat model** and our shared-public-language for partner escalation. We should not build campaign detection (wrong scope, wrong team), but we should tag and report what we observe using DISARM TTP identifiers so partners (DPMC's Counter-Foreign-Interference team, Electoral Commission, platforms, academia) can consume it.

### 2.5 Argumentation-level taxonomies

- KnOD 2021 (*Fact-checking, False Narratives, and Argumentation Schemes*): false narratives work by **omitting crucial argument components and cherry-picking accurate but atypical** instances — the formal machinery behind "misleading content."
- SIFT (Stop, Investigate source, Find better coverage, Trace to original context) — the practical newsroom/literacy method; its "trace to original context" move is precisely the false-context counter.
- Political communication work on decontextualisation (Hameleers 2023) treats it as a resource-cheap, high-yield technique — consistent with its 59% dominance.

---

## 3. Class-by-class: relevance to NZ elections, and verification approach

| Class (Wardle type) | NZ election relevance | Verification approach | Machine tractability |
|---|---|---|---|
| **3. Misleading content / selective statistics** | Core campaign practice (both blocs, every cycle) — the "skewed picture" class | **ADR-0004 engine**: fingerprint + topic pack + sensitivity grid | **High** (claim-vs-official-series) |
| **4. False context / decontextualisation** | Dominant technique in EU 2024; cheap to run: old footage re-dated, other-country incidents framed as NZ, ex-MP statements re-attributed | **Provenance matching**: retrieve original context (date, source, place), compare to claimed context; image/date search; archived-source tracing | Medium-high for text (date/source matching); medium for media |
| **7. Fabricated content** | Second in EU; pure falsehoods about opponents, invented quotes, fabricated statistics | **Open-web verification loop** (our capped FIRE-style mode) — the mode we already planned | Medium-low (AVeriTeC ceiling applies) — hence capped, confidence-labelled |
| **6. Manipulated media / deepfakes** | Generative-AI arms race noted by EDMO as the defining 2024/25 shift; NZ-relevant for candidate-impersonation audio/video | **Provenance-first**: C2PA/Content Credentials where present; reverse search for originals; detection models are unreliable — never verdict on "is this AI" alone | **Out of scope v1**; partner-referral path (Platform/API provenance checks, academic partners); methodology states the limit honestly |
| **5. Imposter content** | Fake Electoral Commission notices, fake newsroom branding, fake candidate statements | **Brand/source verification**: authoritative-source registry (we *know* what real Commission/1News/RNZ URLs look like); report + escalate | High for detection-as-reported (domain/brand mismatch); not a claim-check problem — an incident-report problem |
| **2. False connection** | Headline vs body mismatches in social shares of NZ media | Cross-modal consistency check (headline/caption vs content) | Medium; low priority for v1 |
| **1. Satire/parody** | Low volume in NZ (The Civilian etc.) | Label-as-satire; no verification needed | Trivial classifier task; include in triage so satire isn't "checked" as a claim |
| **Mal-information** | Leaks, true-but-selective personal material | Mostly **out of scope**: collides with privacy/defamation exposure and claims-not-persons; handle as source-governance, not claim-checking | Out of scope v1, stated |

**Cross-cutting: electoral-process claims deserve their own topic pack.** The EU data's top topic was electoral integrity (20.5%) — and in NZ the highest-harm false claims are process claims ("you can vote by text", "enrolment closes Friday", "the election is on both days") because they *suppress votes directly* and because **s 199A criminalises knowing falsehoods about voting in the final 72 hours**. Verification is trivial (Electoral Commission is the single authoritative source, everything is published) and the public value is maximal. This becomes a topic pack with the fastest lane and the lowest freeze threshold.

---

## 4. What this changes in the architecture

1. **Triage becomes technique-aware.** The claim-triage prompt classifies suspected misleading-*technique* class (fabricated / false-context / selective-statistics / satire / imposter-flag / manipulated-flag) alongside check-worthiness and type. This is one additional structured-output field, not a new pipeline.
2. **ADR-0004's stat engine is confirmed as one mode of a three-mode verification layer, not the whole** (already the de facto design: topic-pack mode, citation-check mode, open-web mode). The change: **false-context gets its own fourth mode** — original-context retrieval (when/where/who/what-was-said), comparing claimed vs actual context. Cheap for text claims, bounded for media via reverse-image search on submitted media.
3. **Electoral-process topic pack added** as the highest-priority pack (Electoral Commission as sole T1 authority; trivial verification; maximal harm prevention; freeze-window interaction documented).
4. **Manipulated media: out of scope v1, stated loudly.** Detection models are not reliable enough to verdict on, and a wrong "this is a deepfake" call during the campaign is worse than silence. We: flag suspected manipulated media in triage, publish nothing unaided, and route to partners (provenance tooling, academic collaborators). The methodology page states this boundary explicitly.
5. **Imposter content: handled as incident reporting**, not claim-checking. We maintain the authoritative-source registry (we know our own ingestion corpus intimately); imposter reports enter the contest/submission pathway and are escalated, tagged with DISARM TTPs where applicable.
6. **DISARM tagging for anything campaign-shaped we observe** — shared vocabulary for partners; no campaign-detection engineering of our own.
7. **Verdict vocabulary gains "false context" as a distinct verdict** (genuine content, wrong when/where/who — with the true context shown). This is the 59%-of-verified-disinformation class and it deserves a first-class verdict, not a special case of "false."
8. **"Disinformation" stays out of our verdict vocabulary** — intent is not ours to adjudicate (information-disorder framework's own distinction), and it collides with claims-not-persons.

## 5. Sources (primary)

- Wardle & Derakhshan, *Information Disorder* (Council of Europe, 2017): https://www.coe.int/en/web/freedom-expression/information-disorder / https://www.fondationdescartes.org/en/2020/08/information-disorder-toward-an-interdisciplinary-framework-for-research-and-policy-making
- Wardle's seven types (First Draft, CC-BY): https://guides.temple.edu/c.php?g=646455&p=9816775 (annotated reproduction) / https://firstdraftnews.org
- Elections24Check empirical study (Media and Communication 13/9475, 2025): https://www.uc3m.es/uc3m/media/uc3m/doc/archivo/doc_paper-carlosrociojorge_mac/mac-13---from-fact-checking-to-debunking_-the-case-of-elections24check-during-the-2024-european-elections-3.pdf
- Disinformation in the 2024 EP elections (Media and Communication 13/9525): https://www.cogitatiopress.com/mediaandcommunication/article/view/9525
- DISARM Foundation (Red Framework, CC-BY-SA-4.0): https://www.disarm.foundation/framework
- FIMI framework survey (arXiv:2502.11827): https://arxiv.org/abs/2502.11827
- Carnegie Endowment, *Countering Disinformation Effectively* (2024): https://carnegieendowment.org/research/2024/01/countering-disinformation-effectively-an-evidence-based-policy-guide
- KnOD 2021, *Fact-checking, False Narratives, and Argumentation Schemes*: https://users.ics.forth.gr/~fafalios/KnOD2021/Knod2021_paper_9.pdf
- EDMO, *Propaganda and Disinformation: Lessons from 2024/25 Elections in Europe*: https://edmo.eu/edmo-news/propaganda-and-disinformation-lessons-from-2024-25-elections-in-europe
- SIFT method (Caulfield): https://guides.temple.edu/fakenews/recognize