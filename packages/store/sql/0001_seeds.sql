-- Authority registry seeds: seeds and discoveries share the same table and
-- provenance discipline ('seed' discovered_by, declared rationale).
INSERT INTO "authority" (domain, authority_ref, source_url, tier, rationale, confidence, discovered_by, search_refs)
SELECT * FROM (VALUES
  ('crime-statistics', 'policedata.nz', 'https://www.policedata.nz', 1, 'NZ Police official crime data portal (initial design seed)', 1.0, 'seed', '[]'::jsonb),
  ('economic-forecasts', 'treasury.govt.nz', 'https://www.treasury.govt.nz', 1, 'NZ Treasury official forecasts (initial design seed)', 1.0, 'seed', '[]'::jsonb),
  ('population-estimates', 'stats.govt.nz', 'https://www.stats.govt.nz', 1, 'Stats NZ official population estimates (initial design seed)', 1.0, 'seed', '[]'::jsonb)
) AS seed(domain, authority_ref, source_url, tier, rationale, confidence, discovered_by, search_refs)
WHERE NOT EXISTS (SELECT 1 FROM "authority" WHERE discovered_by = 'seed');
