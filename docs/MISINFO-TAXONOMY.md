# Taxonomies of misleading information — and what they mean for the verification architecture

*Research input to ADR-0005 (verification layer). Surveys the established taxonomies, maps each class to a verification approach, and states what the architecture does per class. Last updated 2026-09-07.*

## 1. The space of misleading information

Election-period claims mislead through distinct mechanisms; no single verification machine handles them all. Three established frameworks:

- **Information disorder** (Wardle & Derakhshan, Council of Europe 2017/2020) — mis-information (false, shared without harmful intent), dis-information (deliberately created to deceive), mal-information (genuine information deployed to harm). Policy-canonical vocabulary, **not used in our verdicts**: adjudicating intent is beyond what evidence can establish, and the labels collide with the claims-not-persons standard.
- **The seven content types** (Wardle / First Draft, CC-BY), ordered loosely by intent to deceive: satire/parody → false connection → misleading content → false context → imposter content → manipulated content → fabricated content.
- **Empirical distributions** from the Elections24Check study of the 2024 European Parliament elections — what fact-checkers actually verified: **decontextualisation (false context) 59.3%** of verified disinformation, **fabricated content 32.9%**; verdicts false 59.4% / **missing context 23.4%** / partly false 5.4% / true 10.4%; **electoral integrity the top topic (20.5%)** ahead of migration (12.9%). **DISARM** (CC-BY-SA) adds the campaign-level TTP vocabulary — used here only for tagging what we observe and partner escalation, not for campaign detection (out of scope).

Why the distributions matter: **true-but-decontextualised content dominates** what fact-checkers verify (59%), and **technically-true-but-selective claims** are the shared failure class across the academic taxonomies and the argumentation literature (KnOD 2021: false narratives work by omitting crucial argument components and cherry-picking accurate-but-atypical instances). Statistical selectivity — the class the ADR-0005 stat engine targets — is one important member of that family, not the whole of it.

## 2. The class-by-class map

| Class (Wardle type) | NZ election relevance | Verification approach | Machine tractability |
|---|---|---|---|
| **3. Misleading content / selective statistics** | Core campaign practice (both blocs, every cycle) | **ADR-0005 stat engine**: fingerprint + evidence store + sensitivity grid | **High** (claim-vs-official-series) |
| **4. False context / decontextualisation** | Dominant EU-2024 technique; cheap: old footage re-dated, other-country incidents framed as NZ, ex-MP statements re-attributed | **Provenance matching**: retrieve original context (date, source, place), compare to claimed context; image/date search; archived-source tracing | Medium-high for text; medium for media |
| **7. Fabricated content** | Second in EU: pure falsehoods, invented quotes, fabricated statistics | **Open-web verification loop** (capped FIRE-style mode) | Medium-low (AVeriTeC ceiling applies) — hence capped, confidence-labelled |
| **6. Manipulated media / deepfakes** | Candidate-impersonation audio/video | **Provenance-first**: C2PA/Content Credentials where present; reverse search for originals; detection models unreliable — never verdict on "is this AI" alone | **Out of scope v1**; partner-referral path; methodology states the limit honestly |
| **5. Imposter content** | Fake Electoral Commission notices, fake newsroom branding | **Brand/source verification**: authoritative-source registry (we know what real Commission/1News/RNZ URLs look like); report + escalate | High (domain/brand mismatch); an incident-report problem, not a claim-check problem |
| **2. False connection** | Headline vs body mismatches in social shares | Cross-modal consistency check | Medium; low v1 priority |
| **1. Satire/parody** | Low volume (The Civilian etc.) | Label-as-satire; no verification | Trivial classifier; included in triage so satire isn't "checked" as a claim |
| **Mal-information** | Leaks, true-but-selective personal material | **Out of scope**: collides with privacy/defamation exposure and claims-not-persons | Stated, out of scope v1 |

**Cross-cutting: electoral-process claims get the fastest verification lane.** The EU data's top topic was electoral integrity; in NZ the highest-harm false claims are process claims ("you can vote by text", "enrolment closes Friday", "the election is on both days") because they *suppress votes directly* and because **s 199A criminalises knowing falsehoods about voting in the final 72 hours**. Verification is trivial (the Electoral Commission is the single authoritative source) and public value is maximal: Electoral Commission retrieved first, lowest freeze threshold.

## 3. What this means for the verification layer (detail in ADR-0005)

1. **Multi-mode by design** — one mode per tractable class: stat engine (statistical claims), citation-check (claim-vs-cited-source), false-context/provenance (decontextualisation), capped open-web loop (fabricated and everything else).
2. **Triage is technique-aware** — the triage pass classifies suspected misleading-*technique* alongside check-worthiness, routing each claim to the mode built for it.
3. **Verdict vocabulary is class-aware** — "false context" is a first-class verdict (genuine content, wrong when/where/who — with the true context shown); "accurate but incomplete" for selective statistics; "disinformation" never appears (intent is not adjudicable by us).

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