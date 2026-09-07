# Legal and compliance (New Zealand)

*Status: design-stage research, not legal advice. Written 2026-09-07 from public sources (linked). A one-off review by an NZ electoral-law practitioner is budgeted before launch; the advertising characterisation question (§2) is the item flagged for it.*

---

## 1. Electoral Act 1993 — s 199A: publishing false statements to influence voters

**The statute:** it is an offence to publish a *statement of fact* that the person **knows is false in a material particular**, with intent to influence voters at a parliamentary election.

**Scope (narrow, and confirmed by the 2017 amendment):** applies only to material **first published on election day or the two preceding days** — a three-day window. Material published earlier and still available is out of scope. There have been no known prosecutions.

**Where our design creates exposure:** a verdict **mutated** during that window on the basis of community-submitted evidence would be a *first publication* in the window. If the mutation were later shown wrong, the knowledge element plus campaign intent could be argued.

**Design response (ADR-006):**
- **Mutation freeze:** from 00:00 on 5 November 2026 until after official results (27 November), no verdict mutates. Contested verdicts display "contested — under review" with the submission logged.
- Freeze logic is part of the verdict state machine (`docs/ARCHITECTURE.md` §3), not a manual process.
- Good-faith process (published methodology, evidence packs, audit log) is the substantive defence to the knowledge element; the freeze removes the window entirely.

## 2. The election advertising regime

**The definition:** an "election advertisement" is an advertisement in any medium that may reasonably be regarded as encouraging or persuading voters to vote or not vote for a candidate, party, or a type of candidate/party described by views they do or don't hold. The Electoral Commission **expressly excludes editorial content (e.g. news items)**.

**Our characterisation:** a fact-check is best read as editorial. But this is **untested** for a site whose entire product is "claim = FALSE" verdicts that mutate via public contestation. If ever characterised as an election advertisement:

- A **promoter statement** (name + contact details of the promoter) is required **at all times**, not just the regulated period; omission is an offence, fine up to $40,000.
- Spending caps and third-party-promoter registration apply during the **regulated period (7 Aug – 6 Nov 2026)** above a spending threshold.

**Design response:**
1. The site never solicits or discourages any vote; non-partisanship is visible and structural (all parties' claims are checked; topic packs are party-blind).
2. **Promoter statement appears in the site footer at all times** — a zero-cost insurance policy against the offence provision.
3. Spend is far below registration thresholds.
4. Flagged for the pre-launch legal review: the editorial/advertising boundary for automated + community-mutated verdicts.

## 3. Defamation

Civil-only regime under the Defamation Act 1992 and common law; **no anti-SLAPP protection** in NZ, so the threat alone is a chill. During an election, whichever side a verdict hurts has incentive and resources.

**Design response (ADR-006):**
- **Claims, not persons**: verdict language addresses claims ("this figure is selective"), never character ("X lied"). Written into every LLM prompt and the community guidelines.
- Evidence-first presentation supports the honest-opinion / public-interest defences.
- Verdicts about people's conduct stay out of scope; statistical and documentary claims are the product.

## 4. Harmful Digital Communications Act 2015

Applies to digital communications about **individuals** that breach communication principles (Principle 3: no false allegations; Principle 5: no harassment; Principle 10: no denigration on protected grounds) and cause serious harm. As operators hosting user-submitted contestations and comments, we are an **"online content host"** with safe-harbour duties: process valid notices within days, take down or disable access if justified, keep records, and stay engaged with complainants; **Netsafe** is the approved complaint agency.

**Design response:** a notice-handling workflow (intake → decision within statutory timeframes → records → Netsafe linkage in the community guidelines) is built alongside contestation intake. Most of our product concerns claims about parties/statistics (out of HDCA scope); the exposure is user comments naming candidates, which moderation tooling addresses.

## 5. Minimal-exposure areas

- **Broadcasting Act 1989**: only relevant to broadcast "election programmes" — not our model.
- **Privacy Act 2020**: minimise contributor profile data; contributor identities are not publicly attached to contestations by default (also a safety measure).
- **Contempt of court**: claims relating to matters before the courts get a suppression-check flag before publication.
- **Copyright**: we ingest and link; we quote only as much as necessary for criticism/review purposes and always link to sources. RNZ RSS content is used as a claim *source*, never syndicated.

## 6. Compliance checklist (build items)

| Item | Where it lands | Status |
|---|---|---|
| Mutation freeze 5–27 Nov 2026 | Verdict state machine | Designed (ADR-006) |
| Promoter statement in footer | Site template | Designed (§2) |
| Claims-not-persons language standard | All prompts + community guidelines | Designed (ADR-006) |
| HDCA notice workflow + Netsafe linkage | Contest intake / moderation | To build with contest feature |
| Privacy-minimal contributor accounts | Contest intake | To build with contest feature |
| Court-matter suppression flag | Verification engine | Backlog |
| Pre-launch electoral-law legal review | — | Budgeted, before soft launch |

## 7. Open legal questions

1. **Advertising characterisation** (§2) — the genuine unknown; flagged for practitioner review.
2. Whether **ClaimReview markup** (which surfaces verdicts inside Google Search panels) changes the advertising analysis — research to date suggests not (the markup describes content; the content is editorial), but it goes in the same legal review.
3. Data-licensing terms of Stats NZ / Figure NZ series for republication as charts — confirm attribution requirements (Stats NZ data generally CC BY 4.0; verify per-series).