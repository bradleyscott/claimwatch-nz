// Search adapter (VERIFICATION §3.3, ADR-0011): Serper as the wired provider —
// Brave/Goggles is routing config later, Serper is live and the fallback/bulk
// provider. The L1 suite exercises the parse/request logic against an injected
// fetch; the real call is LIVE_EGRESS-gated (CRO-R6).

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

export interface SearchProvider {
  search(query: string): Promise<SearchResult[]>;
}

interface SerperOrganicItem {
  title?: string;
  link?: string;
  snippet?: string;
}

/**
 * Creates a Serper-backed search provider. `fetchImpl` is injectable so the
 * deterministic suite runs without network; production passes global fetch.
 */
export function createSerperSearch(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): SearchProvider {
  return {
    async search(query: string): Promise<SearchResult[]> {
      const response = await fetchImpl("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: query }),
      });
      if (!response.ok) {
        throw new Error(`serper search failed: ${response.status}`);
      }
      const body = (await response.json()) as { organic?: SerperOrganicItem[] };
      return (body.organic ?? [])
        .filter((item): item is { title: string; link: string; snippet: string } =>
          typeof item.link === "string" && item.link.length > 0)
        .map((item) => ({
          title: item.title ?? "",
          link: item.link,
          snippet: item.snippet ?? "",
        }));
    },
  };
}