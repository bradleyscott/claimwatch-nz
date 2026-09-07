# Taxonomies of misleading information — and what they mean for the verification architecture

*Status: research input to ADR-0004 (statistical-claim engine) and to the verification layer design. This document surveys the taxonomies of misleading information in the political sphere — much of it developed in the state-actor misinformation context — maps each class to a verification approach, and states what the architecture does per class. Last updated: 2026-09-07.*

---

## 1. The space of misleading information

Election-period claims mislead through several distinct mechanisms, and no single verification machine handles them all. The taxonomy below combines three established frameworks:

- **Information disorder** (Wardle & Derakhshan, Council of Europe 2017/2020) — the intent-and-truthfulness vocabulary: mis-information (false, shared without harmful intent), dis-information (deliberately created to deceive), mal-information (genuine information deployed to harm). This vocabulary is policy-canonical but is *not* used in our verdicts: adjudicating intent is beyond what evidence can establish, and the labels collide with the claims-not-persons standard.
- **The seven content types** (Wardle / First Draft, CC-BY) — a content-shaped typology ordered loosely by intent to deceive: satire/parody → false connection → misleading content → false context → imposter content → manipulated content → fabricated content.
- **Technique distributions from campaign-scale empirical work** — the Elections24Check collaborative study of the 2024 European Parliament elections published what fact-checkers actually verified: **decontextualisation (false context) 59.3%** of verified disinformation, **fabricated content 32.9%**, with verdicts breaking down false 59.4% / **missing context 23.4%** / partly false 5.4% / true 10.4%, and **electoral integrity the top topic (20.5%)** ahead of migration (12.9%). Influence-operation frameworks (**DISARM**, open source, CC-BY-SA) add the campaign-level TTP vocabulary — used here only for tagging what we observe and for partner escalation, not for campaign detection, which is out of scope.

The empirical distributions matter because they discipline design: **true-but-decontextualised content dominates** what fact-checkers verify (59%), and **technically-true-but-selective claims** ("cherry-picking") are the shared failure class across both the academic taxonomies and the argumentation literature (KnOD 2021: false narratives work by omitting crucial argument components and cherry-picking accurate-but-atypical instances). Statistical selectivity — the class ADR-0004's engine targets — is one important member of that family, not the whole of it.

---

## 2. The class-by-class map

Each misleading-information class, its NZ election relevance, the appropriate verification approach, and machine tractability:

| Class (Wardle type) | NZ election relevance | Verification approach | Machine tractability |
|---|---|---|---|
| **3. Misleading content / selective statistics** | Core campaign practice (both blocs, every cycle) — the "skewed picture" class | **ADR-0004 engine**: fingerprint + topic pack + sensitivity grid | **High** (claim-vs-official-series) |
| **4. False context / decontextualisation** | Dominant technique in EU 2024; cheap to run: old footage re-dated, other-country incidents framed as NZ, ex-MP statements re-attributed | **Provenance matching**: retrieve original context (date, source, place), compare to claimed context; image/date search; archived-source tracing | Medium-high for text (date/source matching); medium for media |
| **7. Fabricated content** | Second in EU; pure falsehoods about opponents, invented quotes, fabricated statistics | **Open-web verification loop** (our capped FIRE-style mode) — the mode we already planned | Medium-low (AVeriTeC ceiling applies) — hence capped, confidence-labelled |
| **6. Manipulated media / deepfakes** | Generative-AI arms race noted by EDMO as the defining 2024/25 shift; NZ-relevant for candidate-impersonation audio/video | **Provenance-first**: C2PA/Content Credentials where present; reverse search for originals; detection models are unreliable — never verdict on "is this AI" alone | **Out of scope v1**; partner-referral path (platform/API provenance checks, academic partners); methodology states the limit honestly |
| **5. Imposter content** | Fake Electoral Commission notices, fake newsroom branding, fake candidate statements | **Brand/source verification**: authoritative-source registry (we *know* what real Commission/1News/RNZ URLs look like); report + escalate | High for detection-as-reported (domain/brand mismatch); not a claim-check problem — an incident-report problem |
| **2. False connection** | Headline vs body mismatches in social shares of NZ media | Cross-modal consistency check (headline/caption vs content) | Medium; low priority for v1 |
| **1. Satire/parody** | Low volume in NZ (The Civilian etc.) | Label-as-satire; no verification needed | Trivial classifier task; include in triage so satire isn't "checked" as a claim |
| **Mal-information** | Leaks, true-but-selective personal material | Mostly **out of scope**: collides with privacy/defamation exposure and claims-not-persons; handled as source-governance, not claim-checking | Out of scope v1, stated |

**Cross-cutting: electoral-process claims deserve their own topic pack.** The EU data's top topic was electoral integrity (20.5%) — and in NZ the highest-harm false claims are process claims ("you can vote by text", "enrolment closes Friday", "the election is on both days") because they *suppress votes directly* and because **s 199A criminalises knowing falsehoods about voting in the final 72 hours**. Verification is trivial (the Electoral Commission is the single authoritative source, everything is published) and the public value is maximal. This becomes a topic pack with the fastest lane and the lowest freeze threshold.

---

## 3. What this means for the verification layer (summary; detail in ADR-0004)

1. **The verification layer is multi-mode by design** — one mode per tractable class: topic-pack mode (statistical claims), citation-check mode (claim-vs-cited-source), false-context/provenance mode (decontextualisation), and the capped open-web loop (fabricated and everything else).
2. **Triage is technique-aware** — the triage pass classifies suspected misleading-*technique* alongside check-worthiness, routing each claim to the mode built for it.
3. **Verdict vocabulary is class-aware** — "false context" is a first-class verdict (genuine content, wrong when/where/who — with the true context shown), "accurate but incomplete" for selective statistics, and "disinformation" never appears (intent is not adjudicable by us).

---

## 4. Sources (primary)

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