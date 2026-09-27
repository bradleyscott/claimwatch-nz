# ADR-0023: Verification plans and an emergent procedure library

*Status: Accepted (2026-09-14) · Date: 2026-09-14 · Deciders: Dave*

## Context

ADR-0005 routes a claim to exactly one of five verification modes, by a pure function of the claim
record. `claim.verification_mode` is a single column with a database check constraint allowing exactly
five values, and `evidence_pack.grid_result` is a column shaped around the flagship mode.

Three problems have become visible.

1. **Real claims are compound, and the data model cannot record that.** ADR-0021 rule 5 requires that
   *was it said* and *is it true* be answered separately: the first by the claim's own document, the
   second by research. Routing gives the claim one mode, so the second question has nowhere to live. A
   claim that quotes a person and asserts a number needs two answers, and one slot exists.
2. **The taxonomy was written before any claim arrived, and guesses at what will be needed.** This is
   the architecture ADR-0005 explicitly rejected on the evidence side: *"precomputation bets on a
   prediction that cannot be checked in advance."* Applied to evidence, the principle is that
   indicator-level structure emerges from claim traffic. Applied to methods, the same design kept a
   fixed taxonomy of five. That inconsistency is the gap this ADR closes.
3. **The set has no version and no growth path.** `GRID_AXES_VERSION` and
   `FINGERPRINT_NORMALISATION_VERSION` exist on the cross-cutting config surface; the set of modes does
   not. Adding a mode would change published behaviour with nothing for a scoring run to pin.

A working precedent for emergent reference data already exists in this codebase. The authority
registry (`discoverAuthority`, `authority` table) starts empty, is populated from claim traffic, is
append-only, carries a rationale and provenance per row, and retires by status change rather than
deletion. Its query is built from the canonical category key and **never the claim text**, for a stated
reason: *"the same category always produces the same query, whoever claimed what about it"* — the
motivated-selection hazard.

## Decision

**A claim's check is a plan: an ordered list of steps. Each step invokes a procedure — an auditable,
versioned instrument — or an open-web research pass. The library of procedures is data that accumulates
from past plans, not a taxonomy written into code. The library suggests; it never constrains.**

### 1. The five modes become five procedure records

`stat-grid`, `citation-check`, `quote-fidelity`, `provenance` and `open-web-research` are seeded into the
library as its first five rows. They keep their implementations and their published descriptions. What
changes is their status: each is one entry in a set that can grow, not one of five possible answers.

### 2. A procedure has a fixed shape and an emergent population

The `procedure` table follows the `authority` pattern: fixed schema, append-only, retired by status
change, never deleted.

| Field | Purpose |
|---|---|
| `procedure_ref` | Stable name (`stat-grid`), unique |
| `version` | Today's implementation version; a version change is a behaviour change that re-runs the harness |
| `kind` | `deterministic` \| `research` — whether it computes or retrieves |
| `consumes` / `produces` | Declared input and output shapes, so two procedures can be compared and a reader can see what one needed |
| `cannot_establish` | The stated bound, in plain words |
| `rationale` | Why this procedure exists |
| `provenance` | `discovered_by`, `search_refs`, `created_at` |
| `status` | `active` \| `retired` |

A procedure may compute anything. It may **not** define its own thresholds: tolerances and
admissibility tiers are published criteria that live in code (ADR-0004, ADR-0020), and a procedure
references them. Changing a published threshold is a criterion change, made in the open with a re-run.

### 3. The planner proposes; the library suggests

`planForClaim` returns a plan. Its input carries the claim's canonical category (`canonicalDomain`), the
claim's own features (does it assert a number, quote a person, cite a document, attach to a proposal),
and the claim text. **It carries no speaker and no party field**, so it cannot score the same claim
differently depending on who said it — a structural guarantee in the shape of ADR-0022 rule 1, pinned by
test.

The library's suggestion is a **ranked list of procedures used in past plans for the same canonical
category**. Frequency of use only. Outcomes are never fed back: the library learns *what was done*, never
*what worked*, because learning success would optimise selection toward agreement with the pipeline's own
past assessments and make whatever it is bad at permanently invisible.

### 4. A minimum plan, not a fixed plan

Claim features impose a floor, so a plan can never silently omit the check a claim needed:

- asserts a number → the figures procedure must be **decided on**, and the plan records the decision and
  the reason if it is not run;
- quotes a person → attribution must be decided on;
- cites a document → the document check must be decided on.

The planner may add any step, including procedures absent from the library, and may always include an
open-web research pass. It may not drop a requirement without recording a reason. A dropped requirement
with a reason is an auditable decision; a dropped requirement without one is a defect.

### 5. Plans are stored and published

The plan, each step's procedure and version, its reason, and its outcome are stored on the evidence pack
and rendered on the verdict page, one section per step. A reader can see which procedures ran and which
were considered and declined. The single verdict word stays the four AVeriTeC classes (ADR-0004) and is
**composed** from the step outcomes by a pre-declared rule, so the published word remains
benchmark-comparable while the page records what was actually established.

### 6. The mode set gets a version

`PROCEDURE_LIBRARY_VERSION` joins the cross-cutting config surface and the run provenance tuple, so a
scoring run pins the library it scored against.

## Alternatives considered

- **Keep the five modes and add a sixth for causation.** Rejected as the primary fix: it treats the
  symptom. Compound claims need several checks whatever the total number of modes is.
- **A fixed, larger taxonomy written up front.** Rejected for ADR-0005's own reason: it bets on a
  prediction that cannot be checked in advance, and every mode nobody uses is dead weight.
- **Let the planner invent procedures per claim, with no library.** Rejected: an unauditable procedure is
  worse than a wrong one, because it cannot be found, versioned or compared. This is why the *shape* is
  fixed even though the population is not.
- **Learn procedure selection from verdict outcomes.** Rejected: it optimises toward agreeing with the
  pipeline's own past verdicts, which turns its blind spots into conventions.
- **Keep `claim.verification_mode` alongside the plan.** Rejected: two sources of truth for the same
  decision, and the single-value check constraint would keep re-asserting the taxonomy.

## Implementation (Sept 2026)

Accepted on the same day it was written, because it is built and covered: `packages/store/src/procedure.ts`
(the shape and the five seeded rows), `packages/pipeline/src/plan.ts` (the planner, the required-procedure
floor, `suggestProcedures`), `packages/pipeline/src/claim-parameters.ts` (the typed parse that replaced the
fingerprint), the `procedure` and `verification_plan` tables, the site's per-step trail rendering, and the
`plan.test.ts` / `claim-parameters.test.ts` suites. The fingerprint is deleted rather than deprecated.

## Consequences

- `claim.verification_mode` and its five-value check constraint are removed; the plan on the evidence
  pack replaces it, and the site reads the plan.
- `evidence_pack` gains `plan`. `grid_result` stays as the figures procedure's payload.
- The published accuracy figure becomes a figure for the **mixture of plans actually run**, described
  that way, and reported per procedure wherever the sample is large enough. A fall in accuracy can then
  be traced to a procedure or to a shift in the mixture.
- Everything the library suggests is a suggestion. A planner may always choose a procedure the library
  has never seen, so the library cannot become a straitjacket by construction.
- The full test run (L3) gains a **novel-method stratum**: claims whose correct procedure is not in the
  library. A library that has closed into a rut then shows up as measurable recall failure rather than
  as unnoticed uniformity.
- Cold start is honest, on ADR-0005's precedent: the library begins with five seeded procedures plus
  whatever discovery finds, early claims pay full plan cost, and the methodology page says so rather than
  hiding it behind precomputation.
- `PROCEDURE_LIBRARY_VERSION` changes the run-file shape, so existing run files will not validate and
  the accuracy table must be re-rendered from a fresh run. No hand-edited numbers.
