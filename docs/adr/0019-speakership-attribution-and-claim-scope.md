# ADR-0019: Speakership attribution and claim scope

*Status: Accepted (2026-09-26) · Date: 2026-09-13 · Deciders: Dave*

## Context

ADR-0006 lists `attribute (claimant resolution)` as an ingestion stage, and INGESTION §2.1 repeats it in the shared pipeline shape:

```
[lane worker] → fetch → normalise → attribute (claimant candidates) → dedupe → triage
```

Neither document says what that stage *decides*. INGESTION §3.4 hands "attribution candidates" to triage; no rule anywhere states which sentences in a document are eligible to become claims. The gap is not the absence of an entity model (ADR-0005 supplies one) but the absence of a **scope** rule: whose utterances are worth a verdict at all.

**What the gap produced, observed.** The first live lane run (lane 2, RNZ politics RSS, Sept 2026) triaged one news article into 47 sentences → 33 claims, and the claim selected for verification was the outlet's *own narration*:

> MFAT also played a key role on international policy and diplomacy both at home and in embassies or 'posts' in the Middle East; in Southeast Asia, where more than 90 percent of New Zealand's fuel comes from; and with Pacific partners.

No quotation marks, no attribution verb; RNZ's expository prose. A verdict was published about a journalist's sentence. On the same article: 30 of 46 sentences contained a quote mark, 10 contained an attribution verb, and **15 contained neither** — a bucket that mixes genuine unattributed pull-quotes with the reporter's topic sentences. The genuinely reportable material in the article (an MFAT deputy secretary, quoted immediately either side of that sentence) was skipped, because nothing distinguished the two.

**Why this is a defect and not a preference.**

1. **The artefact is unattributable.** ADR-0005's claimant-entity resolution and ADR-0008's discourse context both key off who spoke. A compound sentence the reporter synthesised has no speaker, so the verdict cannot say whose claim it assesses — the verdict page's "who" line is empty by construction, and the "as deployed" framing has no speaker to attach to.
2. **One rule cannot serve every lane.** A government press release (lane 1) is a case where the publishing body *is* the claimant, so "every forwarded sentence is a candidate" is correct there. Applied to a news report, the same rule verifies the reporter. Lane 1's correct behaviour and lane 2's incorrect behaviour are currently the same code path.
3. **It is the wrong subject.** The project fact-checks claims made in political debate. Assessing a newsroom's prose is media criticism: a different product with a different standard, and it invites the objection that we fact-check journalists rather than politicians.
4. **The safety analysis assumes an identifiable speaker.** ADR-0002's defamation and Electoral Act exposure is about statements by identifiable actors, and its contestation mechanism presupposes someone who can contest on the claim's behalf. Outlet prose has neither.

**What must stay true.** ADR-0008 forbids filling context fields from speaker identity: `attached_proposal`
comes from the window text only. TRIAGE §1 says triage never uses claimant identity as a decision input.
ADR-0006 says attribution never guesses. Any rule here must respect all three, and the boundary between
*eligibility* and *reading* has to be explicit — a naive reading of the existing rules forbids this ADR
outright.

## Decision

### 1. Speakership is classified at ingestion, per sentence, before triage

This is the `attribute` stage ADR-0006 already names. Each sentence receives one class:

| Class | Meaning | Eligible to become a claim |
|---|---|---|
| `quoted-actor` (with an actor candidate) | Reported speech, speaker resolvable from quotation and attribution | **Yes**, if the actor is in scope (§3) |
| `author-claim` | The author of an opinion/analysis piece asserting in their own voice | **Yes**, if the statement is a political claim (§2) |
| `outlet-prose` | Journalist/outlet narration, editorial synthesis, scene-setting | **No** — recorded, never verified |
| `unresolved` | Quotation without resolvable attribution (pull-quotes, spanning quotes, ambiguous speaker) | **No** — never guessed (ADR-0006) |

### 2. The rule is genre-dependent, so genre is classified

Per document: news report · opinion/analysis · press release · transcript (interview / Hansard) · institutional post. Structural signals are preferred where they exist — Hansard speaker markup, caption turn structure (`transcript_tier`, ADR-0007) — and the method used is recorded, because a structural attribution and a classified one carry different confidence.

| Genre | Eligible claimants |
|---|---|
| Press release | The publishing government body, by construction — forwarded sentences stay eligible |
| News report | Quoted in-scope actors only. Outlet prose is out of scope |
| Opinion / analysis | The author's own political claims (factual assertions about political actors, actions or outcomes — not value judgements, predictions, or advocacy); quoted actors if the piece quotes one |
| Transcript | The speaker of the turn (ADR-0008's "preceding speaker turn" — the strongest signal, which is why ADR-0006 calls Hansard the cleanest claimant-entity source) |

### 3. Actor taxonomy

- **In scope**: elected politicians, parties, candidates; **government officials speaking for the government** — a public servant describing or asserting government action or outcomes (the MFAT deputy secretary case); institutional actors per ADR-0018 (think tanks, lobbies, unions, sector bodies).
- **Out of scope as claimants**: journalists and outlets (they are sources of quotation, never claimants); private individuals; commentators and experts, except where they fall under ADR-0018 or are the deliberate author of an opinion piece under §2.
- **Officials**: in scope when speaking for the government about government action or outcomes; a personal or party-political opinion expressed by an official is not in scope on this basis.

### 4. Identity is used for eligibility and attribution only

Speaking identity may decide **whether** a sentence is checked and **who** the verdict names. It may never:

- fill a discourse-context field (ADR-0008's prohibition stands);
- enter the checkability or typing decision — triage receives an eligibility flag plus attribution candidates, not a person to reason about, so TRIAGE §1's boundary is preserved rather than weakened;
- influence the verdict class or evidence selection. Verification remains party-blind (AGENTS rule 5).

### 5. The decision is recorded and disclosed

The claim stores its speakership class, the classification method, the genre, and the actor candidate. The verdict page states who said the claim and how it was attributed — which is what makes the "as deployed" framing (ADR-0008) attachable in the first place. Sentences excluded by speakership are counted per lane as a scope funnel alongside the Tier-2 fallback rate, and the page's "what we did not check" section reports them by class, so "not a claim" and "not ours to check" stay visibly different.

### 6. The project does not fact-check journalists

A consequence worth stating as a boundary: this is a scope rule about whose claims we assess, not a commentary on newsroom accuracy, and media accuracy is out of scope for the project.

## Alternatives considered

- **Keep treating every sentence as a candidate (status quo).** Rejected: publishes unattributable verdicts (demonstrated above) and gives lane 1's correct behaviour and lane 2's incorrect behaviour one code path.
- **Decide speakership inside triage, alongside checkability.** Rejected: puts identity inside the decision that determines scope, breaching TRIAGE §1; and it makes the classifier unauditable, because one call that both finds the claim and decides who said it cannot be measured for either.
- **Mechanical proxy: a sentence is reportable only if it contains a quotation mark.** Rejected: mislabels both ways. In the measured article the attribution verb often sits in a *different* sentence from the quotation, and one pull-quote was entirely unattributed.
- **Only elected and appointed actors; officials enter only as evidence.** Rejected by decision: officials speaking for the government are a primary source of checkable factual claims about government action. Excluding them keeps the government's press releases checkable while dropping its operative statements.
- **Treat any sentence containing a person's name as attributed.** Rejected: names appear throughout narration; presence of a name is not presence of a speaker.

## Consequences

- **Claim volume falls sharply, and the harness sample must be re-derived.** On the one measured article, 15 of 46 sentences were potential outlet prose and 30 contained quotation, before the actor taxonomy filters further. HARNESS §2.2's n≈110 grid is built from per-lane claim volumes (Beehive 15, RNZ 8, institution 7…), so those per-lane label budgets have to come from measured in-scope yields before the L3 run. The gate axis (mode, not lane) is unaffected.
- **A new silent-starvation risk appears.** A lane whose yield collapses to zero in-scope claims looks healthy on every existing signal — the same shape as a feed that answers 200 with no items, and it needs the same kind of alarm (per-lane in-scope rate).
- **Attribution accuracy becomes a measured component**: `unresolved` and misattribution rates per lane, per the iCheck post-mortem lesson ADR-0006 cites.
- **Triage recall measurement (TRIAGE §2.5) changes shape**: the labelled drop-log sample must distinguish a missed claim from correctly excluded outlet prose, or the recall number is diluted by text the project never intended to check.
- **Provenance gains a user-visible line** ("what X said, as reported by RNZ"), which the verdict page can only render once the decision is stored — the "who" line is currently empty for every lane-produced claim.
- **Existing published artefacts produced under the old rule are mis-scoped.** The honest remedy is a superseding verdict version once the rule is implemented, never a silent edit (ADR-0002 append-only).
- **Not decided here**: whether an outlet's own *factual error* is ever in scope (currently no), and how political relevance is operationalised for opinion pieces — see INGESTION §5.
