# Decision log (working notes → ADRs)

This is the running log of the design conversations that produced the ADRs. It exists so the *sequence* of reasoning stays visible: what was considered, what was rejected, and why. ADRs are the stable record; this file is the scratch-pad that shows the path.

---

## 2025–2026 (pre-repo) — problem shaping

- **Origin**: interested in a public fact-checking resource for the NZ election with a sustainable model; initially anchored on openfactcheck.com, which research showed to be an LLM-factuality *benchmark* (research tool), not a product pattern. Spin-off LOKI and the FIRE/AVeriTeC ecosystem are the relevant state of the art.
- **Open-source vs paid LLMs**: decided early that open-source *pipelines* with paid LLM services is the pragmatic split (research frontier runs this way — TUDA_MAI won AVeriTeC 2024 on GPT-4o; open-weights-only 2025 winner scored 33%).
- **Full Fact licensing** examined in depth (charity + trading arm, B2B demo-gated licences, grant-subsidised deployments, £1M Google funding withdrawn 2025). Viable but incompatible with open-scrutiny goals and NZ-specific flagship needs → ADR-0003.
- **Editorial staffing**: initial plan assumed 2–3 editors; rejected in favour of community-contested automated verdicts with mutation-on-validated-evidence. This is the project's defining design move.
- **Legal review** identified four exposures (s 199A, advertising characterisation, defamation, HDCA); the mutation-freeze design and claims-not-persons standard came directly out of this → ADR-0006.
- **Evaluation harness** elevated from "nice-to-have" to core trust asset when the no-editors model was chosen → ADR-0001, ADR-0008.
- **Statistical claims / cherry-picking** identified by Bradley as the core risk class and value opportunity ("the main thing of value is the evidence politicians claim as the basis for their policy proposals") → ADR-0004 flagship.
- **Quick build for 2026**: 8-week plan cut (releases+Hansard first, LLM triage, FIRE-lite, 100-claim harness, simple contest form, freeze logic). ClaimBuster assessed and skipped at this scale.

## 2026-09-07 — repo created

- Repo initialised: `claimwatch-nz` (working name).
- Docs written: research review, architecture (4 mermaid diagrams), evaluation, legal-compliance, ADRs 0001–0008.
- ADR-0003 recorded as the first Decided outcome (build open).
- ADR-0007 (providers) intentionally left Open — needed before pipeline code lands.

## Pending decisions (queue for next ADRs)

1. **ADR-0007** — LLM/search providers (blocks pipeline code).
2. **Verdict store + audit-log schema** (append-only design, public changelog format).
3. **Topic-pack v0 indicator list** — which 20–30 indicators; needs a defensible selection procedure (party-blind, campaign-coverage-based).
4. **Sensitivity grid v0** — the pre-declared alternative-framing grid (draft exists in ARCHITECTURE.md §4; needs formalisation + review).
5. **ClaimReview publisher details** (Google Fact Check Markup Tool vs embedded JSON-LD; likely both).
6. **Site stack** (Next.js vs Astro) and hosting topology on the Proxmox cluster.
7. **Labelled-set labelling workflow tooling** (even at n=100: double-blind assignment, agreement computation).