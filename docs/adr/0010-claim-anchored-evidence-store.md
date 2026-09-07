# ADR-0010: Claim-anchored evidence store — verify claim-by-claim, accumulate context over time

*Status: Proposed · Date: 2026-09-07 · Deciders: Bradley, Dave*

## Context

ADR-0004 defines the verification layer: statistical claims resolve by fingerprint-match and sensitivity check against **topic packs** — pre-computed evidence fields (series, denominator families, grid variants) built per indicator ahead of time. `docs/SOURCE-TAXONOMY.md` maps trusted authorities per domain; `docs/MISINFO-TAXONOMY.md` prioritises which claim classes matter.

Concern with the pre-computed approach: **you can invest heavily in precomputing evidence fields that turn out not to be the right things to validate actual claims with.** Precomputation optimises for a prediction — which indicators will be claimed, and in which framings — that cannot be verified in advance. A pack built around an indicator may still miss the specific framing a claimant uses (framings are not indicator-shaped), and every pack for an unquoted indicator is wasted effort. The claim-detection pipeline itself cannot de-risk this: it predicts claims, it doesn't observe them.

The alternative: **no pre-built packs.** Each claim is verified claim-by-claim through the retrieval loop, and the evidence the loop retrieves is **accumulated into a shared, growing evidence store**. Later claims on similar territory start from what has already been gathered rather than from zero. The dataset asset — validated evidence chains — is the same either way, but in this design it is grounded in claims that actually occurred, and it grows in exactly the shape the election produces.

## Decision

**Verify claim-by-claim; accumulate evidence into a shared store; let indicator-level structure emerge from the claims rather than be pre-built.**

### How a claim is verified (the loop, unchanged in mechanism)

1. **Fingerprint extraction** (unchanged from ADR-0004): indicator × population × geography × time window × baseline × unit.
2. **Evidence-store match** (new): the fingerprint (and its embedding) is matched against the store. If a previous claim already assembled evidence for the same indicator/framing, the loop starts from that evidence — retrieval resumes, it doesn't restart.
3. **Retrieval against the authority map**: fresh retrieval fills gaps, guided by the T1–T6 authority map (`docs/SOURCE-TAXONOMY.md` §2.2) — which authorities exist for the domain, in what order of precedence. The authority map is *retrieval guidance*, not pre-built content.
4. **Sensitivity grid, computed on demand**: the grid **axes** are pre-declared and published (time window with endpoint-trick detection, normalisation, denominator family, comparison cohort, seasonality — per ADR-0004), but the computation runs at claim time over the evidence the loop has assembled. The pre-declaration prevents "you invented the standard to hurt us"; on-demand computation avoids precomputing variants nobody claimed. The LLM selects which grid rows are material to the claim; it never authors the grid.

### What accumulates (the growing dataset)

Every verified claim deposits into the store:

- the claim record (text, fingerprint, speaker, date, source);
- the evidence retrieved (series pulled, documents fetched, snippets, URLs, vintages);
- the grid computation result (which axes were material, what they showed);
- the verdict and its audit trail.

The store is **claim-anchored** — every entry exists because a real claim needed it. Repeat claims resolve in seconds against accumulated evidence (the repeat-matching mechanism from ADR-0002's lane design). Adjacent claims (same indicator, different framing) reuse the series already fetched and extend the grid computation with the new fingerprint's variants. Over the campaign, indicator-level structure — the equivalent of packs — **emerges from claim traffic**: the store organises itself around what was actually disputed.

### Claim relationships (linking claims into narratives)

The store is a graph, not a flat list. Claims are linked by typed relationships:

| Relationship | Meaning | Detected by |
|---|---|---|
| **repeats** | substantially the same claim, re-asserted (by anyone) | fingerprint + embedding match (the repeat-matching mechanism) |
| **corrects** | this claim corrects/retracts/refines an earlier claim (by the same speaker or outlet) | same fingerprint family + later date + corrective language ("I misspoke", "the correct figure is", editorial correction notices); confirmed at mutation review |
| **contradicts** | this claim asserts the opposite of a prior claim (any speaker) | same fingerprint, opposing verdict direction |
| **refines** | same subject, narrower/more precise framing (e.g. a monthly figure quoted after an annual one) | shared indicator fingerprint, differing granularity |
| **responds-to** | this claim was made in direct response to another (debates, press conferences) | temporal + source adjacency; confirmed at mutation review |

**Corrections get first-class treatment.** When claim B **corrects** claim A:

- B's verdict page links visibly to A ("this corrects an earlier statement — see its verdict and history"), and A's page gains a prominent "later corrected by the claimant" banner linking to B. The fuller picture — claim, correction, evidence — is one navigation path from either end.
- A's page is **not silently re-verdicted**: A keeps its verdict (that *was* the assessment of A), with the correction linked. The narrative is shown, not rewritten — this matters for the audit log and for s 199A first-publication clarity (a correction is a new publication; the earlier verdict is history).
- Corrections by the *claimant* are surfaced approvingly — the system's tone treats self-correction as good practice, which is both epistemically right and strategically protective (it gives politicians an incentive to correct through us).
- Correction chains (A → B → C) render as a timeline on each linked page.

**Linking is conservative by default:** automated linking proposes relationships (fingerprint match + corrective-language signals); ambiguous cases are queued for mutation review like contest evidence, and the relationship is only part of the published store once confirmed. False "correction" links would be worse than no links — a claim presented as corrected when it wasn't is a defamatory-adjacent error.

### What this replaces from the pack design

| Pack-design element | Disposition |
|---|---|
| Pre-computed evidence fields | **Dropped** — replaced by on-demand retrieval + accumulated store |
| 9-pack seed build (electoral process first) | **Dropped as build work** — the electoral-process domain still gets the *fastest lane* (Electoral Commission as sole T1, s 199A interaction), but via retrieval priority, not pre-computation |
| Sensitivity grid axes | **Kept** — pre-declared and published before campaign peak (the anti-invented-standard defence); computed on demand |
| Authority map (T1–T6 per domain) | **Kept** — as retrieval guidance configuring the loop, not as pack content |
| Series vintages + revision policy | **Kept** — stored per evidence item; nightly batch re-verification detects revisions |
| Community extension of evidence | **Kept, strengthened** — contest evidence extends the store by definition; the store is the evidence field |
| Batch economics | **Kept** — verification runs are batch-shaped and batch-discounted; the saving shifts from pack-precompute to claim-verification runs |

### Grid axes and the "reasonable alternatives" defence

The grid axes remain pre-declared and published before campaign peak — identical for every claim about an indicator, shown on the verdict page. What changes is only *when* they are computed: at claim time, over accumulated + freshly retrieved evidence, rather than in advance. The LLM selects which grid rows are material to the claim; it never authors the grid. This preserves ADR-0004's defence against the "invented standard" attack while removing the precomputation dependency.

## Alternatives considered

- **Pre-computed topic packs** (the prior design). Rejected: optimises for a prediction that can't be verified in advance; risks building the wrong evidence fields while missing the framings actually used; pack construction is effort ahead of evidence of need.
- **Hybrid: pre-compute only the highest-frequency packs, accumulate the rest.** Rejected for v1: the highest-frequency indicators only become known from claim traffic (the first weeks of operation produce exactly this signal); precomputing before observing duplicates the prediction problem. If a small number of indicators do dominate after launch, pre-computing *their* evidence fields becomes an optimisation of the store, revisitable then.
- **Pure open-web loop for everything, no store.** Rejected: throws away the compounding value — repeat and adjacent claims would pay full retrieval cost every time, and the store is the research/licensing asset.

## Consequences

- **No pack-construction workstream** — the build effort shifts entirely to the retrieval loop, the store, and the authority-map configuration.
- **Cold start is honest**: early claims pay full retrieval cost; the store warms as the campaign proceeds. This is visible in the published methodology rather than hidden by precomputation.
- **The store is the asset**: validated evidence chains organised by claim, growing with the campaign — the same licensable/research dataset identified in ADR-0008, now claim-anchored from day one.
- **Grid axes are pre-declared; grid computation is on demand** — the methodology page publishes the axes and the rule that materiality selection is automated but auditable.
- **The electoral-process lane is a retrieval-priority rule** (Electoral Commission consulted first, fastest verification path), not a pre-computed pack.
- **The claim graph is a new build item**: typed-relationship detection (repeats / corrects / contradicts / refines / responds-to) sits alongside repeat-matching in the store; correction-linking needs the conservative review queue before publication.
- **Narrative rendering**: verdict pages for linked claims show their relationship chains (claim → correction → refinement), giving readers the full picture — and making the store's history navigable, which is what makes the correction incentive real.