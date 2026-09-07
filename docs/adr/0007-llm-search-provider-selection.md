# ADR-0007: LLM and search provider selection

*Status: Open · Date: 2026-09-07 · Deciders: Bradley, Dave*

## Context

The pipeline uses paid model APIs (per ADR-0003, no open-weights constraint) and a web-search API. Selection criteria for the 2026 cycle:

1. **Cost at campaign volume** (FIRE benchmarks: GPT-4o-mini-class ≈ $0.14/claim LLM cost in the verification loop)
2. **Quality on extraction and claim-vs-source comparison** (our flagship modes are extraction-heavy, not reasoning-heavy)
3. **Structured-output reliability** (fingerprints, verdict JSON, evidence-pack schemas)
4. **Provider stability through Nov 2026** (no mid-campaign API changes)

## Options under consideration

| Option | Notes |
|---|---|
| OpenAI GPT-4o-mini class | FIRE's measured cost-efficiency point; strong structured output |
| Anthropic Haiku class | Comparable cost band; strong citation behaviour |
| Gemini Flash class | Competitive cost; long context useful for Hansard |
| Self-hosted (Ollama on homelab) | Free inference, slower; viable for bulk triage, weaker at verification |

## Decision

**Open — leaning to a two-tier design:** a mini-class API model for all interactive verification, and (optionally) a self-hosted local model for bulk triage where latency doesn't matter. Search API: Brave or Serper (both have free tiers adequate for the 2026 volume).

To be decided before the first pipeline code lands (week 1 of the build); the harness must pin and record model versions for reproducibility regardless of choice.

## Consequences

- All prompts and schemas must be provider-portable (no single-vendor SDK lock-in in the pipeline code).