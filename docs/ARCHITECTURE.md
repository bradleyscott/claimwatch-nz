# Architecture

*Proposed design, pre-implementation. Each major decision has an ADR in [`adr/`](adr/). Diagrams are inline Mermaid (rendered natively by GitHub); PNG exports in [`diagrams/`](diagrams/).*

## 1. System context

ClaimWatch sits between NZ's open political-data infrastructure and the public. Two kinds of external relationship, deliberately kept distinct: **claim sources** — publications whose claims flow *into* the pipeline and get checked — and **verifier authorities** — official data/record sources consulted as *evidence*, never treated as claims to check. A claim source is something we are prepared to disagree with; a verifier authority is something independently assessed as trustworthy for its domain (the T1–T6 map in `SOURCE-TAXONOMY.md` §2.1). A Stats NZ data table is never triaged as a document that might contain a politician's claims; a press release is never consulted as evidence for its own statistics. The distinction is structural: claim-source content enters the evidence store only through claim extraction; authority content enters only as referenced evidence items. Hansard and Beehive overlap deliberately — the role is per-artefact by document type (a minister's Hansard statement is a claim source; the Hansard record of *who said what when* is also attribution evidence). The ADR-0013 proposal pathway governs what counts as an authority and what gets ingested.

```mermaid
flowchart TB
    subgraph CLAIM_SOURCES["Claim sources — publications that may contain claims"]
        BEEHIVE["Beehive.govt.nz<br/>releases + speeches (RSS)"]
        PARTIES["Party release pages<br/>(headless render)"]
        HANSARD["Hansard<br/>official transcripts"]
        NEWS["News RSS<br/>RNZ · NZ Herald · Stuff · Newsroom"]
        SUBMIT["User submissions<br/>URLs + text (claim pointers)"]
        BCAST["Broadcast/podcast interviews<br/>publisher transcripts + captions (ADR-0007)"]
    end

    subgraph AUTHORITIES["Verifier authorities — evidence sources (never claim feeds)"]
        STATS["Stats NZ<br/>Aotearoa Data Explorer (SDMX/JSON)"]
        MOJ["MoJ · Police (policedata.nz)<br/>justice series"]
        ELECTORAL["Electoral Commission<br/>electoral process + party registration"]
        OTHER["Treasury · RBNZ · Te Whatu Ora<br/>domain series per T1–T6 map"]
    end

    subgraph CW["ClaimWatch (open source)"]
        INGEST["Claim-source ingestion<br/>6 lanes, health-checked (ADR-0006)"]
        TRIAGE["Claim detection + typing<br/>+ discourse context (ADR-0008)"]
        VERIFY["Verification engine<br/>multi-mode (ADR-0005)"]
        STORE["Evidence + verdict store<br/>claim-anchored, append-only (ADR-0005)"]
        SITE["Public site<br/>ClaimReview markup"]
        CONTEST["Contestation intake<br/>+ evidence validation (ADR-0002)"]
    end

    PUBLIC["Public:<br/>read, contest, submit evidence"]
    SEARCH["Search APIs<br/>Brave · Serper (ADR-0011)"]
    AUDIT["Retrospective audit<br/>sampled daily, high-impact always"]

    BEEHIVE --> INGEST
    PARTIES --> INGEST
    HANSARD --> INGEST
    NEWS --> INGEST
    SUBMIT --> INGEST
    BCAST --> INGEST
    INGEST --> TRIAGE
    TRIAGE --> VERIFY
    VERIFY -- "retrieve official series<br/>(evidence, never claims)" --> AUTHORITIES
    VERIFY -- "open-web retrieval" --> SEARCH
    VERIFY --> STORE
    STORE --> SITE
    SITE --> SEARCH
    SITE --> PUBLIC
    PUBLIC --> CONTEST
    CONTEST --> VERIFY
    CONTEST --> AUDIT
    AUDIT --> STORE
```

Verifier authorities are deliberately limited to public, structured, official data for v1 (ADR-0006); social platforms are excluded from claim sources too. The verification engine reads official series directly rather than relying on what a release cited (ADR-0005) — the citing politician chooses the evidence; we reconstruct the field.

## 2. Pipeline dataflow

```mermaid
flowchart LR
    A["Raw document<br/>release / Hansard / article"] --> B["Sentence split<br/>+ metadata"]
    B --> C{"LLM triage:<br/>checkable claim?"}
    C -- "no" --> Z["dropped<br/>(logged for eval)"]
    C -- "yes" --> D["Claim record:<br/>text + type + fingerprint<br/>+ discourse context (ADR-0008)<br/>+ publication/segment refs (ADR-0008)"]
    D --> E{"Claim type"}
    E -- "statistical" --> F["Fingerprint match<br/>to evidence store"]
    F --> G["Sensitivity grid<br/>over official series"]
    E -- "citation-backed" --> H["Fetch cited doc<br/>claim-vs-source check"]
    E -- "other factual" --> I["Open-web loop<br/>question decomposition,<br/>confidence-capped depth"]
    G --> J["Evidence pack<br/>+ verdict + confidence"]
    H --> J
    I --> J
    J --> K["Verdict store<br/>versioned, labelled open-to-contest"]
```

Three verification modes by claim class (ADR-0005). Statistical claims resolve against the claim-anchored evidence store; citation-backed claims get a bounded claim-vs-source comparison; everything else gets the open-web loop with confidence-capped retrieval depth — AVeriTeC shows this mode is the least reliable, so it is capped, labelled, and its verdicts are the most visibly "open to contest."

## 3. Verdict lifecycle (the mutation model)

```mermaid
stateDiagram-v2
    [*] --> DRAFT: claim detected
    DRAFT --> PUBLISHED: verified + evidence pack assembled
    PUBLISHED --> CONTESTED: contest submitted
    CONTESTED --> VALIDATING: evidence validation runs
    VALIDATING --> PUBLISHED: evidence rejected<br/>(rejection reason logged, public)
    VALIDATING --> MUTATED: evidence accepted<br/>verdict mutates automatically<br/>v2 published with diff
    MUTATED --> AUDIT: sampled retrospective audit<br/>(all high-impact reviewed)
    AUDIT --> PUBLISHED: audit confirms (or reverts<br/>with reason, both logged)
    PUBLISHED --> FROZEN: mutation freeze window<br/>(5 Nov – after results, 27 Nov)
    FROZEN --> PUBLISHED: freeze lifts (after 27 Nov)
```

Every transition is logged; nothing is ever silently edited (ADR-0001, ADR-0002). A validated evidence pack triggers mutation automatically; a sampled retrospective audit checks validator quality without gating it (ADR-0002). The freeze is the design response to Electoral Act s 199A (`LEGAL-COMPLIANCE.md` §1).

## 4. The statistical-claim engine

```mermaid
flowchart TB
    CLAIM["Quoted claim:<br/>'Crime up 30% since 2017'"] --> FP["Fingerprint extraction<br/>indicator × population × geography ×<br/>time window × baseline × unit"]
    FP --> CTX["Discourse context (ADR-0008):<br/>policy proposal, argument direction —<br/>selects MATERIAL grid rows"]
    FP --> MATCH{"Match in evidence store?"}
    MATCH -- "yes" --> SERIES["Accumulated evidence<br/>(series already fetched,<br/>versioned)"]
    MATCH -- "no" --> RETRIEVE["Retrieve series<br/>from verifier authorities"]
    RETRIEVE --> SERIES
    SERIES --> GRID["Sensitivity grid:<br/>window variants · per-capita ·<br/>denominator family · cohorts · seasonality"]
    GRID --> CLASS{"Claim robust<br/>across grid?"}
    CLASS -- "yes" --> V1["Verdict: accurate<br/>+ full field shown"]
    CLASS -- "no" --> V2["Verdict: accurate but incomplete<br/>+ alternatives table + charts"]
    V2 --> FIELD["Evidence field<br/>append-only, versioned"]
    V1 --> FIELD
    FIELD --> PUBLISH["Published verdict page:<br/>chart-first, ClaimReview markup,<br/>'as deployed' line (ADR-0008)"]
```

The claim is often true — the verdict is about the *representativeness of the framing*, assessed against the claim's discourse context: the proposal it supports and its argument direction determine which grid rows are material to the deployment, while the grid itself stays pre-declared and identical for every claimant (the defence against "you invented the standard to hurt us"; ADR-0005). Series accumulate from real claims, so repeat and adjacent claims resolve from stored evidence. Grading: `EVALUATION.md`.

## 5. Contestation → validation → mutation

```mermaid
sequenceDiagram
    participant U as Member of public
    participant S as Contest intake
    participant V as Validation pipeline
    participant Q as Mutation (automated)
    participant A as Retrospective audit
    participant D as Verdict store (append-only)

    U->>S: dispute verdict + cited sources
    S->>S: rate-limit + email verify
    S->>V: evidence submitted
    V->>V: retrieve + authenticate source<br/>provenance · authority · corroboration
    alt Evidence fails validation
        V->>D: rejection logged (public, with reason)
        V-->>U: notified with reason
    else Evidence passes
        V->>Q: validated evidence pack triggers mutation
        Q->>D: v(n+1) published with public diff<br/>+ contributor credit (opt-in)
        Q->>Q: sampled retrospective audit<br/>(all high-impact reviewed)
        Q->>D: audit finding logged (revert w/ reason if needed)
        D-->>U: notified of outcome
    end
```

The validation step is the anti-brigading mechanism in v1 (ADR-0002): submitted noise must survive provenance checks to matter, so volume attacks die in quality gates rather than vote arithmetic. Every rejection is public and reasoned, keeping bad-faith patterns visible.

## 6. What we are explicitly NOT building for 2026

- Parliament TV / broadcast transcription — publisher transcripts/captions only; self-generated transcription out of scope (ADR-0007)
- Social-platform firehose ingestion
- Bridging-weighted community rating (post-election, with data to justify it — ADR-0002)
- Māori-language claim processing (acknowledged gap; roadmap item with iwi/kaupapa partners)
- Auto-publishing verdicts without the contest pathway
- Pre-computed topic packs (superseded by the claim-anchored evidence store — ADR-0005)

## 7. Hosting and operations

Self-hosted on the existing Proxmox cluster behind Cloudflare; zero cloud vendor lock-in for site and data. Paid services: LLM API + search API only. The verdict store, audit log, and labelled datasets are the durable assets, backed up outside the election-window lifecycle. Pipeline observability is Grafana-only (ADR-0012).

## 8. Implementation stack

TypeScript (Vercel AI SDK, no orchestration framework), Postgres as the single data plane (pgvector + FTS + pg_cron), Drizzle schema/migrations — per ADR-0014. The validation slice (`VALIDATION-SLICE.md`) is the first build target.

## 9. Diagram index

| Diagram | File |
|---|---|
| System context | `docs/diagrams/system-context.png` |
| Pipeline dataflow | `docs/diagrams/pipeline-dataflow.png` |
| Verdict state machine | `docs/diagrams/verdict-lifecycle.png` |
| Contest → mutation sequence | `docs/diagrams/contestation-sequence.png` |