// Search adapter (VERIFICATION §3.3): Serper per ADR-0011 (Brave primary is
// routing config, not code — Serper is the fallback/bulk provider and the one
// whose key is live). Deterministic L1 suite runs against a mock transport;
// the real-call test is LIVE_EGRESS-gated (CRO-R6: the default suite never
// touches paid APIs).
//
// Authored BEFORE implementation (TDD red). Do not mutate without approval.

import { describe, expect, it } from "vitest";
import { createSerperSearch, type SearchProvider, type SearchResult } from "./serper-adapter.ts";

// Mock transport: the adapter's own logic (request shape, response parsing,
// error mapping) is what L1 tests — not the network.
function mockProvider(
  results: SearchResult[],
  failures = 0,
): { provider: SearchProvider; calls: string[] } {
  const calls: string[] = [];
  let failureCount = 0;
  return {
    calls,
    provider: {
      async search(query: string): Promise<SearchResult[]> {
        calls.push(query);
        if (failureCount++ < failures) {
          throw new Error("transient search failure");
        }
        return results;
      },
    },
  };
}

describe("serper adapter (VER-R3 retrieval surface)", () => {
  it("returns parsed organic results from the response body", async () => {
    // The real transport is exercised by the LIVE_EGRESS-gated test; here the
    // parse path runs against a canned response via the injected fetch.
    const canned = {
      organic: [
        {
          title: "Vehicle theft stats",
          link: "https://www.police.govt.nz/about-us/statistics",
          snippet: "Recorded crime…",
        },
        {
          title: "Someone's blog",
          link: "https://example.blogspot.com/theft",
          snippet: "Opinions…",
        },
      ],
    };
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify(canned), { status: 200 });
    const provider = createSerperSearch("test-key", fakeFetch);
    const results = await provider.search("NZ vehicle theft statistics official");
    expect(results).toHaveLength(2);
    expect(results[0]?.link).toBe("https://www.police.govt.nz/about-us/statistics");
    expect(results[1]?.title).toBe("Someone's blog");
  });

  it("maps HTTP failures to a typed error, never undefined results", async () => {
    const fakeFetch: typeof fetch = async () => new Response("rate limited", { status: 429 });
    const provider = createSerperSearch("test-key", fakeFetch);
    await expect(provider.search("anything")).rejects.toThrow(/serper search failed: 429/);
  });

  it("tolerates a missing organic array (empty result set)", async () => {
    const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({}), { status: 200 });
    const provider = createSerperSearch("test-key", fakeFetch);
    const results = await provider.search("obscure query");
    expect(results).toEqual([]);
  });

  it("sends the API key header and JSON query body", async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    const fakeFetch: typeof fetch = async (url, init) => {
      captured.push({ url: String(url), init: (init ?? {}) as RequestInit });
      return new Response(JSON.stringify({ organic: [] }), { status: 200 });
    };
    const provider = createSerperSearch("k-test", fakeFetch);
    await provider.search("crime stats");
    expect(captured[0]?.url).toBe("https://google.serper.dev/search");
    expect((captured[0]?.init.headers as Record<string, string>)["X-API-KEY"]).toBe("k-test");
    expect(JSON.parse(String(captured[0]?.init.body)).q).toBe("crime stats");
  });
});

describe.runIf(process.env.LIVE_EGRESS === "1")("serper live smoke (LIVE_EGRESS=1)", () => {
  it("returns organic results for a real query", async () => {
    const provider = createSerperSearch(process.env.SERPER_API_KEY ?? "");
    const results = await provider.search("New Zealand police recorded crime statistics 2024");
    expect(results.length).toBeGreaterThan(0);
  });
});

// Re-export for the vetting tests' mock seam.
export { mockProvider };
