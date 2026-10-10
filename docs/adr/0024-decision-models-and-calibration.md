# ADR-0024: Decision models — a typed decision port, with calibration as the gate

*Status: Accepted · Deciders: Dave*

## Context

Several of the pipeline's LLM roles are not generation tasks at all: they classify into a closed
vocabulary — triage's per-sentence class (11 values), the critiquer's sufficiency and verdict class,
and the source tier. They are on the verdict tier because their errors are public-quality, which is
the right reason, and they are billed at $2.00/M in and $10.00/M out to buy that.

A System One decision model changes the shape of the problem. **Jev** (TypeSafe) answers a named
set of questions with typed values — `choice` (one of up to 255 labelled options), `score` (an
ordered 2–10 scale), `noul` (a calibrated yes/no as a probability) — several in one round trip. It
cannot return an option outside the list it was given, so it cannot invent a class name. And it
returns a probability with every answer, which is the signal a binary classification never carries:
which decisions were marginal.

**Availability, verified rather than assumed:** OpenRouter serves it at
`POST /api/alpha/decisions` — not `/chat/completions`, which rejects a decisions model outright.
`typesafe/jev-1.13` resolved to `typesafe/jev-1.13-20260917`. Pricing **$0.042/M input, $0 free**;
32k context; output modality `decisions` (`has_text_output: false`). A 16-item calibration run cost
**$0.000407**. The response reports `provider: "TypeSafe"`, meaning OpenRouter proxies to the origin
operator — permitted under ADR-0011 rule 1 (US-hosted) and required to be recorded under rule 3.

## Decision

**A decision port sits alongside the generative port, and a decision model is adopted per role only
after a measured calibration curve on our own claims.**

### 1. Two ports, because the contracts differ

`LlmPort` asks for a schema and gets text that happens to parse. `DecisionPort` asks for a named set
of questions and gets typed answers with probabilities. Collapsing them would let a decision role be
asked for prose it cannot produce, or a prose role be asked for a bare choice, losing the reasoning
the NLI gate audits. The split makes a role's transport visible in its type.

The role vocabulary is unchanged: a decision role is a `PROMPT_ROLES` entry, so a run manifest can
still record provenance for it (HAR-R7). Its *instructions* are versioned separately
(as a `role@n` string like any other prompt), because the instructions are the artefact.

The decision roles are the CLOSED-VOCABULARY classifications: `triage-speakership` (the class, with
the attribution name escalated) and `triage-checkability` (a pure choice). `evidence-critiquer` is
deliberately NOT a decision role: its `sufficient` and `verdictClass` are closed choices, but its
`reason`, `gaps` and `justifications` are published prose that a decision primitive cannot produce, so
routing it there would either lose the prose or move published copy to a weak model.

### 2. Threshold and escalate, never replace

A confident answer is taken; a marginal one is escalated to the generative model in a batched call.
The threshold is a published criterion in ADR-0004's sense — it moves only with a measurement behind
it, and it is set to the value the routed role was measured at (0.70), not a round number chosen for
comfort. The escalation rate is a recorded funnel number, and unlike today's binary it says *which*
decisions were marginal.

### 3. Calibration is measured, not assumed

The whole design rests on "0.9 means 90% right", which is a vendor claim about their data.
`packages/harness/src/calibration.ts` measures it here: a reliability curve, the Brier score, the
signed overconfidence gap, and a threshold table giving settle-share and settled accuracy. A role
gates on a threshold only when a run clears the accuracy floor, and the run file carries the
provenance to reproduce it.

### 4. A decision outage degrades to today's behaviour

A failed call escalates every sentence rather than throwing or guessing. A decision outage therefore
costs money and latency, never correctness. The `degraded` flag is explicit so a caller cannot
confuse it with a document that had no sentences.

### 5. Two transports, and the local one is the fallback

OpenRouter's decisions endpoint, and Ollama's `/v1/systemone` running locally. The local path is
exempt from ADR-0011's foreign-operator rule entirely (no operator in the loop, no egress), and it
gives the alpha endpoint a fallback that is a config change. `/api/alpha/decisions` is alpha, and
there is a freeze window starting 5 November.

## Calibration

The port, the escalation path, the question builders and the calibration arithmetic are implemented
and tested (`packages/pipeline/src/{decision-port,decision-stage,decision-questions}.ts`,
`packages/harness/src/calibration.ts`). A threshold is a published criterion and moves only with a
measured calibration curve behind it.

**Measured on 88 hand-labelled NZ political sentences** (`ops/calibrate-decisions.ts` against
`packages/pipeline/fixtures/triage-labelled.json`, 22 per speakership class), which settles the two
roles differently:

- **triage-speakership — not cleared.** Accuracy 55.7%, expected calibration error 18.5%, Brier 0.278
  against a 0.25 coin flip. The reliability curve is non-monotonic: answers stated at 70–80% are right
  33% of the time, and no threshold that settles at least 20 items reaches the 95% floor. The model is
  not accurate enough at whose-words-is-it, so this arm stays generative.
- **triage-checkability — accuracy cleared, labels short.** At threshold 0.70 the model settles 25 of
  44 eligible items at 96.0% accuracy, above the floor, with a near-calibrated curve (gap −2.4%,
  Brier 0.146). The gate is blocked only on coverage: the labelled set has 34 `checkable` items but
  1–4 for each of `opinion`, `procedure`, `rhetoric` and `pledge-conditional`, and the gate needs n≥20
  per class.

### Routing in force

**`triage-checkability` is routed to the decision model** (`DEFAULT_DECISION_ROLES`), at threshold
0.70, with the generative model taking the escalated remainder. The basis is the accuracy measurement
above, which clears the 95% floor on the settled subset with a higher settle-share than any other
threshold. `triage-speakership` is not routed: the measurement says the model is not accurate enough
at that question, and a live run confirmed it — routing speakership took one document from 6 claims to
21 and raised the run's cost, because prose was read as an assertion.

**The decider accepted a known shortfall in doing so.** The set is short of n≥20 labels per content
class, so the accuracy figure rests on 44 eligible items rather than a class-balanced set. The decider's
reasoning is that a larger labelled set is expected to reach the same conclusion, so the shortfall is
accepted as a deliberate exception rather than waited on. It remains a labelling task, not a code task:
the set must reach n≥20 per class before the figure is as strong as the gate intends, and until then
this routing is a measured bet rather than a settled result. `DECISION_ROLES` overrides the default —
unset takes it, an empty value turns the routing off, and a list routes exactly the roles it names.

The measurement sends each item with its surrounding context, because a cross-sentence quotation
scored alone asks a question the real path never asks.
## Alternatives considered

- **Route the classification roles to a cheaper generative model instead.** Rejected as the primary
  move: it buys cost and keeps the weakness that a generative classifier can emit a class outside the
  vocabulary, and it gives no probability to threshold on. The existing ADR-0011 recommendation of
  Gemini Flash for triage remains open on its own merits and is a separate change.
- **Use `typesafe/jev-router`.** Rejected: it is a meta-router that picks a model per request
  (`has_text_output: true`, no endpoints listed). Delegating model choice to a black box contradicts
  ADR-0011, whose entire point is per-role selection by measured harness performance with a published
  routing table.
- **Replace the generative model outright for a classification role.** Rejected: the class is a
  closed choice but the attribution NAME is free text, which no decision primitive produces. Escalation
  is per-item precisely so the escalated set is the items whose name matters.
- **Bundle several roles into one decision request.** Rejected for now: it is the obvious latency
  win, but each role has its own versioned instructions and the manifest pins `promptVersions` per
  role. Bundling needs a `role_bundle` concept first, or per-role attribution is lost.
- **Trust the provider's returned `usage.cost`.** Rejected: cost is computed at aggregation from the
  versioned price map (ADR-0012), so a rate change re-prices history instead of freezing a figure.

## Consequences

- `packages/pipeline/src/decision-port.ts` (the port, the primitives, the OpenRouter client),
  `packages/pipeline/src/decision-stage.ts` (settle-and-escalate, with the degradation path) and
  `packages/pipeline/src/decision-questions.ts` (the versioned instructions).
- `packages/harness/src/calibration.ts` (the arithmetic) and `ops/calibrate-decisions.ts` (the run).
- `openrouter:typesafe/jev-1.13` joins the price map at $0.042/M in, $0 out.
- **`triage-checkability` runs on the decision model** by default, with the generative model taking the
  escalated remainder; `triage-speakership` stays generative on the measurement. The default is a
  config override away from being turned off (`DECISION_ROLES`).
- The measured calibration figure is a published number like any other: it comes from a run file with
  its provenance, and it is never hand-edited.
- A standing obligation for the harness: **the labelled triage set must reach n≥20 per content class**,
  because the accuracy figure behind the live `triage-checkability` routing rests on 44 eligible items.
  Closing it is a labelling task, not a code task, and the routing is a measured bet until it is done.
- A new failure mode to handle: a local Ollama transport is a GPU availability dependency, which
  needs the same degradation discipline the lanes already have for a source.
