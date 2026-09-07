# Architecture

*Status: proposed design, pre-implementation. Each major decision has an ADR in [`adr/`](adr/). Diagrams are inline Mermaid (rendered natively by GitHub); PNG exports live in [`diagrams/`](diagrams/).*

---

## 1. System context

ClaimWatch NZ sits between NZ's open political-data infrastructure and the public. Everything flowing in is public data; everything flowing out is public, versioned, and contestable.

```mermaid
flowchart TB
    subgraph SOURCES["NZ open data — public"]
        BEEHIVE["Beehive.govt.nz<br/>releases + speeches (RSS)"]
        PARTIES["Party release pages<br/>scraped"]
        HANSARD["Hansard<br/>official transcripts"]
        NEWS["News RSS<br/>RNZ · NZ Herald · Stuff"]
        STATS["Official series<br/>Stats NZ · MoJ · LAWA · Figure NZ"]
    end

    subgraph CW["ClaimWatch (open source)"]
        INGEST["Ingestion"]
        TRIAGE["Claim detection + typing"]
        VERIFY["Verification engine"]
        STORE["Verdict store<br/>append-only + audit log"]
        SITE["Public site<br/>ClaimReview markup"]
        CONTEST["Contestation intake<br/>+ evidence validation"]
    end

    PUBLIC["Public:<br/>read, contest, submit evidence"]
    SEARCH["Google / Bing<br/>fact-check panels"]
    stewards["Mutation review queue<br/>human check (v1)"]

    BEEHIVE --> INGEST
    PARTIES --> INGEST
    HANSARD --> INGEST
    NEWS --> INGEST
    INGEST --> TRIAGE
    TRIAGE --> VERIFY
    STATS --> VERIFY
    VERIFY --> STORE
    STORE --> SITE
    SITE --> SEARCH
    SITE --> PUBLIC
    PUBLIC --> CONTEST
    CONTEST --> VERIFY
    CONTEST --> stewards
    stewards --> STORE
```

**Reasoning:** sources are deliberately limited to public, structured, official data for v1 (ADR-002). Social platforms are excluded — API costs and gating are high, and Hansard + releases + news cover the bulk of claimable on-record material. The verification engine reads official statistical series directly rather than relying on what a release cited (ADR-004) — the citing politician chooses the evidence; we reconstruct the field.

## 2. Pipeline dataflow

```mermaid
flowchart LR
    A["Raw document<br/>release / Hansard / article"] --> B["Sentence split<br/>+ metadata"]
    B --> C{"LLM triage:<br/>checkable claim?"}
    C -- "no" --> Z["dropped<br/>(logged for eval)"]
    C -- "yes" --> D["Claim record:<br/>text + type + fingerprint"]
    D --> E{"Claim type"}
    E -- "statistical" --> F["Fingerprint match<br/>to topic pack"]
    F --> G["Sensitivity grid<br/>over official series"]
    E -- "citation-backed" --> H["Fetch cited doc<br/>claim-vs-source check"]
    E -- "other factual" --> I["Open-web loop<br/>FIRE-style, capped"]
    G --> J["Evidence pack<br/>+ verdict + confidence"]
    H --> J
    I --> J
    J --> K["Verdict store<br/>v1, labelled open-to-contest"]
```

**Reasoning:** three verification modes by claim class (ADR-004). Statistical claims go against pre-computed topic packs (fastest, highest accuracy); citation-backed claims get a bounded claim-vs-source comparison; everything else gets the general open-web loop with a strict step budget — we know from AVeriTeC that this mode is the least reliable, so it is capped, labelled, and its verdicts are the most visibly "open to contest."

## 3. Verdict lifecycle (the mutation model)

```mermaid
stateDiagram-v2
    [*] --> DRAFT: claim detected
    DRAFT --> PUBLISHED: verified + evidence pack assembled
    PUBLISHED --> CONTESTED: contest submitted
    CONTESTED --> VALIDATING: evidence validation runs
    VALIDATING --> PUBLISHED: evidence rejected<br/>(rejection reason logged, public)
    VALIDATING --> MUTATION_REVIEW: evidence accepted<br/>verdict change proposed
    MUTATION_REVIEW --> PUBLISHED: human check approves<br/>v2 published with diff
    MUTATION_REVIEW --> PUBLISHED: human check rejects<br/>(reason logged, public)
    PUBLISHED --> FROZEN: mutation freeze window<br/>(5–7 Nov 2026)
    FROZEN --> PUBLISHED: freeze lifts (after 27 Nov)
```

**Reasoning:** every transition is logged; nothing is ever silently edited (ADR-001, ADR-006). The freeze window is the legal design response to Electoral Act s 199A (see legal doc). In v1 the "human check" is a small daily review task by the operator; the post-election design replaces this with bridging-weighted community review (ADR-005).

## 4. The statistical-claim engine (flagship)

```mermaid
flowchart TB
    CLAIM["Quoted claim:<br/>'Crime up 30% since 2017'"] --> FP["Fingerprint extraction<br/>indicator × population × geography ×<br/>time window × baseline × unit"]
    FP --> PACK{"Topic pack<br/>for indicator?"}
    PACK -- "yes" --> SERIES["Canonical series<br/>(pre-computed, versioned)"]
    PACK -- "no" --> RETRIEVE["Retrieve series<br/>from official sources"]
    RETRIEVE --> SERIES
    SERIES --> GRID["Sensitivity grid:<br/>window variants · per-capita ·<br/>denominator family · cohorts · seasonality"]
    GRID --> CLASS{"Claim robust<br/>across grid?"}
    CLASS -- "yes" --> V1["Verdict: accurate<br/>+ full field shown"]
    CLASS -- "no" --> V2["Verdict: accurate but incomplete<br/>+ alternatives table + charts"]
    V2 --> FIELD["Evidence field<br/>append-only, versioned"]
    V1 --> FIELD
    FIELD --> PUBLISH["Published verdict page:<br/>chart-first, ClaimReview markup"]
```

**Reasoning:** the claim itself is true — the verdict is about the *representativeness of the framing*. A pre-declared, published sensitivity grid makes the judgment criterion explicit and identical for every party and claim (this is the defence against "you invented the standard to hurt us"). Topic packs turn live verification into lookup + arithmetic against official data, which is where our accuracy will be highest. See ADR-004 and `docs/EVALUATION.md` for how this is graded.

## 5. Contestation → validation → mutation

```mermaid
sequenceDiagram
    participant U as Member of public
    participant S as Contest intake
    participant V as Validation pipeline
    participant Q as Mutation review (human, v1)
    participant D as Verdict store (append-only)

    U->>S: dispute verdict + cited sources
    S->>S: rate-limit + email verify
    S->>V: evidence submitted
    V->>V: retrieve + authenticate source<br/>provenance · authority · corroboration
    alt Evidence fails validation
        V->>D: rejection logged (public, with reason)
        V-->>U: notified with reason
    else Evidence passes
        V->>Q: proposed verdict change + new evidence pack
        Q->>D: v(n+1) published with public diff<br/>+ contributor credit (opt-in)
        D-->>U: notified of outcome
    end
```

**Reasoning:** the validation step is the anti-brigading mechanism in v1 (ADR-005) — noise can be submitted but must survive provenance checks to matter, so volume attacks are neutralised by quality gates rather than by vote arithmetic. Every rejection is public and reasoned, which keeps the process auditable and keeps bad-faith actors visible.

## 6. What we are explicitly NOT building for 2026

- Parliament TV / broadcast transcription (ADR-002)
- Social-platform firehose ingestion
- Bridging-weighted community rating (post-election, with data to justify it — ADR-005)
- Māori-language claim processing (acknowledged gap; roadmap item with iwi/kaupapa partners)
- Auto-publishing verdicts without the contest pathway

## 7. Hosting and operations

Self-hosted on existing infrastructure (Proxmox cluster) behind Cloudflare; zero cloud vendor lock-in for the site and data. Paid services: LLM API + search API only. The verdict store, audit log, and labelled datasets are the durable assets and are backed up outside the election window lifecycle.

## 8. Diagram index

| Diagram | File |
|---|---|
| System context | `docs/diagrams/system-context.png` |
| Pipeline dataflow | `docs/diagrams/pipeline-dataflow.png` |
| Verdict state machine | `docs/diagrams/verdict-lifecycle.png` |
| Contest → mutation sequence | `docs/diagrams/contestation-sequence.png` |