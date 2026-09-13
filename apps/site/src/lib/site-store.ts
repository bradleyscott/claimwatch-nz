// Site store (SITE-MVP §3.1): the site is a READER over the typed store —
// no write path to claims/verdicts (feedback stays behind the API route).
// Three surfaces: the live Postgres reader, a fixture-backed store for L4a
// smoke tests + empty-store edges (SIT-R14), and the DI seam pages render
// through.
//
// The LIVE reader and the read model both live in `@cw/store`
// (`site-reader.ts`): the store owns the single definition of
// claim/verdict/evidence shapes (STORE §2.1), and the site's own SELECT list was
// string SQL that nothing bound to the schema (Sept 2026). This module keeps
// only the DI seam and the fixtures; the read-model types are re-exported so
// page code and tests keep importing them from `@/lib/site-store`.

import type { SiteReader, SiteReadOptions } from "@cw/store";
import { createSiteReader, FeedEntry, VerdictPageData } from "@cw/store";

export type { SiteReader, SiteReadOptions };
export { FeedEntry, VerdictPageData };

export interface SiteStore {
  getVerdictPage(claimId: string, opts?: SiteReadOptions): Promise<VerdictPageData | null>;
  getFeed(
    page: number,
    pageSize: number,
    opts?: SiteReadOptions,
  ): Promise<{ entries: FeedEntry[]; hasMore: boolean }>;
}

/**
 * `?corpus=all` on a page switches the reader to the records that are NOT
 * eligible for the public record: no ingested document, or a speakership class
 * that is out of scope (ADR-0019). The public default is provenance-backed,
 * positively in-scope claims only — see `SiteReadOptions.includeIneligible` for
 * why, and keep this the ONLY place the query string is interpreted.
 */
export function readOptionsFromSearch(
  search: Record<string, string | string[] | undefined> | undefined,
): SiteReadOptions {
  return { includeIneligible: search?.corpus === "all" };
}

/** Fixture-backed store for L4a smoke tests and the empty-store edge case (SIT-R14). */
export function fixtureSiteStore(
  entries: FeedEntry[],
  pages?: Record<string, VerdictPageData>,
): SiteStore {
  return {
    async getVerdictPage(claimId) {
      return pages?.[claimId] ?? null;
    },
    async getFeed(page, pageSize) {
      const start = page * pageSize;
      return {
        entries: entries.slice(start, start + pageSize),
        hasMore: entries.length > start + pageSize,
      };
    },
  };
}

/** Live Postgres reader over the typed store (SITE-MVP §3.1). Read-only. */
export function liveSiteStore(databaseUrl: string): SiteReader {
  return createSiteReader(databaseUrl);
}

// DI seam: L4a render tests pin the fixture store; production installs the
// live reader via installLiveStore (one-way latch — pages don't re-install per
// request). resetSiteStore clears the latch for hermetic tests.
let activeSiteStore: SiteStore = fixtureSiteStore([]);
let liveInstalled = false;
let pinnedOverride = false;

export function getSiteStore(): SiteStore {
  return activeSiteStore;
}

export function setSiteStore(store: SiteStore): void {
  activeSiteStore = store;
}

/** Installs the live reader once; later calls are no-ops. */
export function installLiveStore(databaseUrl: string): void {
  if (liveInstalled || pinnedOverride) return;
  setSiteStore(liveSiteStore(databaseUrl));
  liveInstalled = true;
}

/** Test seam: pins the fixture store AND blocks installLiveStore re-latching. */
export function pinFixtureStore(store: SiteStore): void {
  setSiteStore(store);
  pinnedOverride = true;
  liveInstalled = false;
}

/** Test seam reset: clears the latch so a pinned fixture store takes effect. */
export function resetSiteStore(): void {
  setSiteStore(fixtureSiteStore([]));
  liveInstalled = false;
  pinnedOverride = false;
}
