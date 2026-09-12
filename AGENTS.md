# AGENTS.md — ClaimWatch NZ

Guidance for coding agents. Read this first, then the doc that owns whatever you are changing
(`docs/design/*.md` are the operative specs; `docs/adr/` is the decision record).

## What this is

Open-source, publicly inspectable fact-checking for factual claims made in NZ political debate,
built for the 2026 general election. Verdicts are automated assessments — contestable, mutated only
by validated evidence, never silently edited (public diff + append-only audit log).

Fixed external dates: regulated advertising period 7 Aug – 6 Nov 2026 · election day 7 Nov 2026 ·
results declared 27 Nov 2026 · verdict mutation freeze 5 Nov → after results. The freeze is baked
into schema statuses (`FROZEN`), not just prose.

**Current state (2026-09-12):** the repo contains working code, not only design. `packages/{store,
pipeline,llm,harness}` and `apps/site` all have implementations and tests, and `ops/*.ts` runs live
end-to-end one-claim slices. `README.md`'s "documentation and design phase" status line is stale —
treat `docs/design/` + ADRs as the spec and the code as the truth.

## Non-negotiable project rules

Breaking one of these is a bug regardless of test results.

1. **Claims, not persons** (ADR-0002). Verdict copy, templates, fixtures, and docs address what was
   said, never a person's character. No "lied" / "dishonest" / degree-slider language anywhere.
2. **Append-only history.** Never `UPDATE`/`DELETE` rows in `verdict_version`,
   `verdict_transition_log`, `evidence_pack`, or `evidence_item`. A verdict changes by appending
   version n+1 with a stored diff and a transition-log entry. A migration that mutates historical
   rows fails review (CRO-R12/STO-R1).
3. **Blind rule** (HARNESS §2.4, `docs/EVALUATION.md` §3, CRO-R14). The pipeline must never read labels. Labels live in a
   separate database (`LABELS_DATABASE_URL`), label credentials never enter pipeline env, and
   `packages/pipeline` must never import `@cw/harness`. `packages/harness/src/blind-rule.test.ts`
   enforces role denial, import direction, and env separation — never weaken those tests.
4. **No hand-edited numbers.** The published accuracy table is rendered from a harness run file
   carrying its provenance tuple (pipeline/prompt/model versions, grid-axes version, data vintages,
   search config). Never edit a run file or the rendered table by hand; a re-run is auditable, a
   hand-edit is not.
5. **Evidence first, party-blind.** Design arguments, doc claims, commits, and label disputes cite
   primary sources. No rubric exception for any party; if a criterion feels biased, change the
   published criterion.
6. **No secrets in the repo.** Keys come from `.env` (gitignored) or CI secrets. Never commit keys,
   tokens, passwords, `.env`, or key material in fixtures/snapshots/prompts.
7. **ADR before contradiction** (`docs/adr/README.md`). If code must contradict an accepted ADR,
   supersede the ADR first, in the open. New ADRs take the next number and are added to the
   `docs/adr/README.md` table; every ADR is Context → Decision → Alternatives → Consequences.
8. **No paid API calls by default.** L1 tests mock all LLM/search access; live smoke tests are gated
   behind `LIVE_EGRESS=1` (CRO-R6). CI must be green with no API keys present.
9. **Two registers** (SITE-MVP §2.2). Public pages use layperson language; "sensitivity grid",
   "extraction ladder", "NLI audit", "Tier-2 caption", and "stratum" are banned outside the
   provenance block and `/methodology`.

## Commands

```bash
pnpm install                 # pnpm 11.8.0 only; Node >= 24 (engines + CI)
pnpm typecheck               # tsc --noEmit in every workspace
pnpm test                    # vitest run at root: all packages + site
pnpm lint                    # biome check (lint + format)
pnpm format                  # biome check --write — run before committing
pnpm db:migrate              # apply packages/store migration chain to DATABASE_URL
pnpm db:generate             # drizzle-kit generate after a schema edit
```

- One file / one name: `pnpm exec vitest run packages/pipeline/src/triage.test.ts`,
  `pnpm exec vitest run -t "fingerprint"`.
- Live runs (real LLMs + search, real spend): `npx tsx ops/live-one-claim.ts`,
  `npx tsx ops/live-averitec-one.ts [claimIndex]`; slice acceptance checklist:
  `npx tsx ops/slice-acceptance.ts`.
- Postgres: `docker compose up -d db` (pinned `pgvector/pgvector:pg18`, same image as CI). Copy
  `.env.example` → `.env`; `DATABASE_URL` and `LABELS_DATABASE_URL` must name **different
  databases**.
- Verified 2026-09-12: `pnpm typecheck` and `pnpm test` are green (27 files, 239 tests, ~3 s).
  `pnpm lint` currently reports pre-existing findings in `ops/`, `packages/harness/`,
  `apps/site/`, `vitest.config.ts`, and `tsconfig.base.json` — don't sweep unrelated lint fixes
  into a feature commit, but do keep your own files clean.

## Repo map

| Path | Responsibility | Owning spec |
|---|---|---|
| `apps/site/` | Next.js 16 SSR reader over the store: verdict pages, feed, methodology page, ClaimReview JSON-LD, feedback route. Read-only apart from feedback. | `docs/design/SITE-MVP.md` |
| `packages/store/` | Postgres data plane: Drizzle schema, generated migrations, append-only store API, ClaimReview build/validate, domain helpers, blind-rule grants. | `docs/design/STORE.md` |
| `packages/pipeline/` | Ingestion lanes, extraction ladder, triage, verification modes (stat-grid, citation-check, quote-fidelity, provenance, open-web), search adapters, live LLM adapter. | `docs/design/{INGESTION,TRIAGE,VERIFICATION}.md` |
| `packages/llm/` | Cross-cutting config surface (`GRID_AXES_VERSION`, `FINGERPRINT_NORMALISATION_VERSION`) and provider/prompt plumbing. | `docs/design/CROSS-CUTTING.md` §2–3 |
| `packages/harness/` | AVeriTeC + NZ label scoring, golden set, regression gate, exports, labels-DB schema, blind-rule tests. | `docs/design/HARNESS.md` |
| `tools/averitec-eval/` | Pinned official Python eval script — a scoring step only, never a runtime dependency. | `tools/averitec-eval/averitec-pinned/PIN.md` |
| `ops/` | Runnable live/acceptance scripts (`tsx`). | `docs/VALIDATION-SLICE.md` |
| `docs/design/` | Component specs with numbered risk IDs, test postures, open questions. | — |
| `docs/adr/` | Decision record (stable; `docs/DECISION-LOG.md` holds working notes). | `docs/adr/README.md` |

## Package boundaries

| From | May import | Must not import |
|---|---|---|
| `pipeline` | `store`, `llm` | `harness`, labels DB |
| `harness` | `store`, `llm` | `pipeline` source |
| `site` | `store` (read) | `pipeline`, `harness` |
| `llm` | `zod` | `store`, `pipeline`, `harness` |

`packages/harness/package.json` declares `@cw/pipeline` as a workspace dependency but no harness
source imports it — the blind-rule test asserts *source* imports. Don't read that dependency as
permission to import pipeline code.

## Code conventions

- Strict TypeScript everywhere (`tsconfig.base.json`: `verbatimModuleSyntax`,
  `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`). NodeNext means
  relative imports carry the explicit `.ts` extension; `@/…` resolves to `apps/site/src`.
- Zod at every boundary — LLM structured output, HTTP payloads, harness run files, row shapes —
  and derive types with `z.infer` rather than writing duplicates.
- `packages/store`'s Drizzle schema is the single definition of claim/verdict/evidence shapes,
  shared by pipeline (write), site (read), and harness (export). **Bump `STORE_SCHEMA_VERSION`**
  (`packages/store/src/index.ts`) whenever an exported shape changes — CRO-R13 fails the run if
  store and harness export versions diverge.
- Store changes: edit `src/schema/*.ts` → `pnpm db:generate` → review the generated SQL in
  `packages/store/drizzle/` → `pnpm db:migrate`. Never hand-write a migration or edit an applied
  one; add a new one instead. No ad-hoc DDL.
- Every LLM/search call emits model + token telemetry (`gen_ai.*` spans, ADR-0012). Cost is computed
  at aggregation from the versioned price map — never pinned at call time, never stored per span.
- Prompts are code and live in the pipeline module that uses them (e.g.
  `packages/pipeline/src/search/decompose.ts`); any prompt edit is a model-equivalent behaviour
  change → L2 golden diff, and L3 re-run if it ships. Record the prompt version in stored artefacts.
- Comments carry decision provenance — `// <what/why> (Name, Month Year)`. Follow that when you
  record a judgement call.
- Biome owns formatting (2-space, 100 cols, double quotes). No ESLint/Prettier, no alternate
  package manager or runtime (ADR-0014). Suppress with `// biome-ignore <rule>: <reason>` — a
  reason is mandatory.
- Avoid `any`, `@ts-ignore`, and `@ts-nocheck`; if one is genuinely needed, say why in the same
  line's comment.

## Tests

Four layers (`docs/TEST-STRATEGY.md` §2):

| Layer | What | When |
|---|---|---|
| **L1** | Deterministic: fixtures, arithmetic, parsers, gates; LLM/search mocked | Every push — where nearly all work happens |
| **L2** | ~20 pinned claims → snapshot verdict, confidence, evidence path, justifications | Every PR; a pipeline/prompt/model change must show a *readable* diff |
| **L3** | AVeriTeC (Layer 1) + NZ n≈110 stratified (Layer 2), real spend | Weekly + pre-release; per-stratum −5 pt (n≥20) / overall −3 pt blocks release |
| **L4** | ClaimReview JSON-LD validation, site snapshot/register tests, deploy smoke | Every push / pre-release |

- Colocate tests as `<module>.test.ts` beside the module; fixtures live in the package's
  `fixtures/` directory.
- Store tests use `createTestStore(DATABASE_URL, { scratchSuffix: "-something" })`, which **drops
  and recreates an entire database** named `<db><suffix>`. Never point it at a database you care
  about, and give every suite its own suffix (parallel forks share the server).
- Vitest's include globs are explicit: `packages/*/src/**/*.test.ts`,
  `apps/*/src/**/*.test.{ts,tsx}`, plus bracketed Next.js route dirs via
  `apps/*/src/**/\[*\]/**`. A test placed outside those patterns silently never runs.
- Requirements stated in docs are often pinned as tests (per-lane funnel instrumentation, idempotent
  re-ingest, blind rule, gate thresholds, site register and section order). When behaviour changes,
  change the doc and the test in the same commit.
- Never `.skip` a test to get green, and never assert a live provider resolved without
  `LIVE_EGRESS=1` (CRO-R6, HAR-R1).

## Site-specific

- `apps/site/AGENTS.md` (written by `next dev`) warns that this Next.js version differs from
  training data — read `node_modules/next/dist/docs/` before writing Next code, and keep that
  generated block in commits so the tree stays clean.
- Verdict-page section order is an invariant, verdict-first: claim quote + attribution → verdict
  mark → one-sentence plain verdict → "as deployed" tag → hear-it/watch-it → evidence pack →
  provenance → related claims. Confidence is small metadata text only — never a meter, bar, star
  rating, or headline element (SIT-R6).
- Verdict content must be server-rendered in the first response (SEO + no-JS resilience): no
  client-side fetching for verdict-first content. `SITE_STORE=live` + `DATABASE_URL` switches pages
  from fixtures to Postgres; `SITE_REPO_ROOT` locates the repo for the methodology page's harness
  artifact.
- Build templates from `docs/mockups/` (`claim-page*.html`, `feed.html`); `entity-chain-submit.html`
  is explicitly out of scope. A missing or invalid accuracy artifact must **fail the site build**,
  not render an empty table.

## Conventions for commits and docs

- Conventional commits with a package scope and an em-dash summary: `feat(pipeline): …`,
  `fix(site): …`, `refactor(store): …`, `test(harness): …`, `chore(ops): …`, `docs: …`,
  `security: …`, `ci: …`. `wip(design):` marks deliberately paused work.
- One concern per commit; name the risk ID or ADR you satisfy when one applies (e.g. `(STO-R7)`,
  `(CRO-R6)`).
- Work lands on `main`; CI is the gate and runs `pnpm install --frozen-lockfile` → `pnpm lint` →
  `pnpm typecheck` → `pnpm db:migrate` → `pnpm test` against a pinned `pgvector/pgvector:pg18`
  service. Commit the lockfile with any dependency change.
- Docs and datasets are CC BY 4.0; code is MIT. Documentation claims cite sources; disagreements
  with a design are welcome as issues or competing ADRs.

## Gotchas

- `packages/harness/data/dev.json` (the AVeriTeC dev set) is gitignored via `data/` — obtained
  locally, never commit it.
- The pinned Python eval script runs only as a scoring step with `numpy scipy sklearn nltk leven`
  plus NLTK tokenizer data; Python must appear nowhere in the pipeline or site runtime.
- Live scripts and `LIVE_EGRESS=1` tests hit real APIs and cost money — the L3 run cap is $25, and
  the campaign budget alerts at 80% of plan.
- The compose `worker` service is a deliberate placeholder (`sleep infinity`) until Graphile Worker
  handlers land; job scheduling state lives in Postgres (`graphile_worker` tables).
- The working tree is frequently mid-change (the tree at time of writing carries an in-flight site
  refactor and an untracked `pnpm-lock.yaml`); check `git status` before assuming a clean baseline.
