// Price map (CROSS-CUTTING §2, ADR-0011): the one versioned place a token count
// becomes money. Cost is computed at AGGREGATION from this map — never pinned at
// call time and never stored per span (ADR-0012), because prices change far more
// often than recorded spans should be invalidated. A price change is a one-file
// edit that re-prices history without rewriting it.
//
// Scope: the models in the live routing table (`live-adapter.ts` DEFAULT_ROUTING)
// plus the escalation/replacement candidates ADR-0011 names. Models that exist
// only in a LIVE_EGRESS smoke test are deliberately absent — an unknown lookup
// fails loudly rather than silently costing zero, so a routing change that lands
// without a price entry is caught by the harness cost column instead of
// under-reporting spend.
//
// Units: USD per 1M tokens, list price (ADR-0011's table).
// `cacheRead` is the cached-input read rate where the provider publishes one;
// absent means no published cached-input tier for that model.

/** Version of the price map below. Joins the reproducibility tuple: a cost
 * figure is only comparable to another when both name the same price map. */
export const PRICE_MAP_VERSION = "prices-2026-09";

export interface ModelPrice {
  /** USD per 1M input tokens. */
  in: number;
  /** USD per 1M output tokens. */
  out: number;
  /** USD per 1M cached-input (cache-read) tokens, where published. */
  cacheRead?: number;
  /** Where the rate came from, so a stale row is auditable. */
  source: string;
}

/** Keyed `provider:model`, matching the adapter's routing and its recorded
 * `modelVersions` values — the same string, so a cost lookup and a provenance
 * record can never disagree about which model ran. */
export const PRICE_MAP: Record<string, ModelPrice> = {
  // Verdict tier (ADR-0011: adjudication + confidence).
  "anthropic:claude-fable-5.1": {
    in: 10.0,
    out: 50.0,
    cacheRead: 0.25,
    source: "ADR-0011 table",
  },
  "anthropic:claude-opus-5": { in: 5.0, out: 25.0, source: "ADR-0011 table" },
  "anthropic:claude-sonnet-5": {
    in: 2.0,
    out: 10.0,
    source: "ADR-0011 table (intro pricing permanent)",
  },

  // Second-opinion / cross-family check.
  "openai:gpt-5.6-sol": {
    in: 4.0,
    out: 20.0,
    source: "ADR-0011 table (promo to Nov 21, 2026)",
  },
  "openai:gpt-5.6-luna": { in: 0.2, out: 1.2, source: "ADR-0011 table" },

  // High-volume tier.
  "gemini:gemini-3.8-flash": {
    in: 0.75,
    out: 3.75,
    source: "ADR-0011 table (promo to Dec 31, 2026; $1.50/$7.50 from Jan 1, 2027)",
  },
  // Served by a US-hosted aggregator (ADR-0011 rule 3); rate is the OpenRouter
  // third-party rate, and the serving mode is recorded on the routing entry.
  // Jev — a System One decision model (ADR-0024). Output is free: the answer is
  // a typed value, not generated text, so there is no completion to bill. The
  // rate is OpenRouter's published figure, which is ~6x below the rate on
  // TypeSafe's own site; a call is ~$0.000015 at our prompt sizes.
  //
  // The key is the model the ROUTING asks for. The provider may resolve it to a
  // dated pin (`typesafe/jev-1.13-20260917`) and report that back — the adapter
  // records the resolved string in `modelVersions`, so a provenance record names
  // what actually ran while the price lookup stays stable.
  "openrouter:typesafe/jev-1.13": {
    in: 0.042,
    out: 0,
    source: "OpenRouter model page, TypeSafe Jev 1.13",
  },
  "openrouter:z-ai/glm-5.3-flash": {
    in: 0.075,
    out: 0.25,
    source: "ADR-0011 table (OpenRouter third-party rate)",
  },
  "openrouter:moonshotai/kimi-k3": {
    in: 3.0,
    out: 15.0,
    source: "ADR-0011 table",
  },
};

export interface TokenUsage {
  tokensIn: number;
  tokensOut: number;
  /** Cached-input tokens, when the provider reports them separately. */
  cachedTokensIn?: number;
}

/**
 * Cost in USD for one call, rounded to 8 decimal places (a single cheap-tier
 * call is ~1e-4, so rounding at 6 would erase the small ones in a per-role sum).
 * Throws on an unknown model: a silent 0 would make a mis-routed or newly-added
 * model look free.
 */
export function costUsd(modelKey: string, usage: TokenUsage): number {
  const price = PRICE_MAP[modelKey];
  if (price == null) {
    throw new Error(
      `no price for "${modelKey}" in ${PRICE_MAP_VERSION} — add it to PRICE_MAP (packages/llm/src/prices.ts) when you add it to the routing table`,
    );
  }
  const cached = usage.cachedTokensIn ?? 0;
  // Cached tokens are billed at the cache-read rate where published; they are a
  // subset of the reported input count on every provider we route through.
  const uncachedIn = Math.max(0, usage.tokensIn - cached);
  const inCost = (uncachedIn * price.in + cached * (price.cacheRead ?? price.in)) / 1_000_000;
  const outCost = (usage.tokensOut * price.out) / 1_000_000;
  return Math.round((inCost + outCost) * 1e8) / 1e8;
}
