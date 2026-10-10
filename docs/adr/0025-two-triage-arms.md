# ADR-0025: Two triage arms — whose words, and what they are

*Status: Accepted · Deciders: Dave*

## Context

Two different questions are asked about a sentence before it can be fact-checked:

1. **Whose words is it?** A newsroom's own narration is not a claim by anyone. Reported speech
   (`quoted-actor`) and an opinion author's own assertion (`author-claim`) are; outlet narration
   (`outlet-prose`) and an unattributable quotation (`unresolved`) are not.
2. **What is it?** A factual assertion evidence could settle is checkable; an opinion, rhetoric,
   procedure, satire, question, an off-domain statement, or a pledge with no deadline passed is not.

The two questions are **independent and overlap**. A quoted actor can state an opinion ("this is a
disaster"), be rhetorical, or be satirical. An opinion author can assert a hard fact. So the classes are
not one mutually-exclusive vocabulary: a sentence can be someone's words *and* an opinion at the same
time. A single class per sentence cannot represent that, and whichever arm it drops is silently lost.

The firewall that matters is the **input**: neither arm may read a claimant's name, party or history as
a decision input, so neither can score the same sentence differently by speaker. Verification below
triage remains party-blind.

## Decision

**Two independent per-sentence arms. A sentence is checkable only when both pass.**

### 1. Arm one — speakership

One class per sentence, from the document's genre:

| Class | Eligible |
|---|---|
| `quoted-actor` — reported speech with a resolvable speaker | yes |
| `author-claim` — an opinion/analysis author asserting in their own voice | yes |
| `outlet-prose` — narration, synthesis, scene-setting | no |
| `unresolved` — a quotation whose speaker cannot be resolved | no |

`author-claim` is available only when the genre is `opinion-analysis`; in a news report the author's own
assertion is `outlet-prose`.

### 2. Arm two — content

Run only on sentences that pass arm one. One class per sentence:

| Class | Checkable |
|---|---|
| `checkable` — a factual assertion evidence could settle | yes |
| `opinion` | no |
| `rhetoric` | no |
| `procedure` | no |
| `satire` | no |
| `question` | no |
| `off-domain` | no |
| `pledge-conditional` | held |

The content arm judges what the sentence asserts, not who said it: a quotation of a factual claim is
checkable even though it is reported speech.

### 3. Both arms must pass

A sentence becomes a claim only when it is someone's words **and** a factual assertion. Every other
sentence is recorded with the reason the arm that failed gave — one drop log, two possible arms. A
`pledge-conditional` sentence is held, not dropped.

### 4. The arms read text and genre only

Each call's input is the sentence text and the document's genre (the content arm also sees the
speakership class it is judging). Neither carries a claimant name, party or claim history.

### 5. Fail closed

A sentence an arm does not answer is recorded as `unresolved` (arm one) or `off-domain` (arm two) —
never promoted to a claim. A missing answer can never look like coverage.

### 6. Bounded and versioned

Each arm is one call per sentence chunk (at most 20 sentences or 6000 characters), retried at half size
on a schema failure. Each arm has its own prompt version and its own model recorded.

## Alternatives considered

- **One class from one vocabulary (the single-class design).** Rejected: the vocabularies overlap, so a
  single value cannot carry both facts, and the arm it drops is lost.
- **One call returning two fields.** Rejected: the two questions have different inputs (arm two needs
  arm one's answer to run at all) and different fan-outs (arm two sees only eligible sentences). Two
  calls keep each arm independently measurable and each prompt single-purpose.
- **Drop the speakership arm and check every sentence.** Rejected: it publishes verdicts about a
  newsroom's own narration.
- **Drop the content arm and check every eligible sentence.** Rejected: it spends verification on
  opinions, satire and questions.

## Consequences

- Two per-sentence calls per document, the second over eligible sentences only: roughly one and a half
  times the fan-out of a single-arm design, and each arm is separately measured.
- The drop log records one reason per sentence from whichever arm failed; the published "what we did not
  check" disclosure is unchanged in shape.
- A quoted opinion is now correctly set aside as an opinion, where a single-class design had to choose.
- The speakership class, method and genre still gate the public record; a class with no method or genre
  does not publish.
