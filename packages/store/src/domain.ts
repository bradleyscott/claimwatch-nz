// Domain canonicalisation (user direction, Sept 2026): the triage fingerprint's
// free-text domain ("Covid Mortality", "covid-mortality", "pandemic deaths")
// must resolve to ONE registry key, or discovery fragments and re-runs per
// phrasing. Deterministic first — with discovery non-blocking, a missed
// normalisation costs a wasted search, not a stall. LLM normalisation may
// follow later; the cache below stays authoritative.

// Canonical form: lowercase, hyphenated, trimmed, whitespace collapsed.
export function normaliseDomain(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Known real-world synonyms — the deterministic alias layer. Entries are
// category-level, not source-level: "pandemic-deaths" and "covid-mortality"
// are the same CLAIM CATEGORY (mortality during the pandemic), so they share
// discovered authorities.
const ALIASES: Record<string, string> = {
  "covid-deaths": "covid-mortality",
  "pandemic-deaths": "covid-mortality",
  "covid19-mortality": "covid-mortality",
  crime: "crime-statistics",
  "criminal-justice": "crime-statistics",
  "vehicle-crime": "crime-statistics",
  "the economy": "economic-forecasts",
  economy: "economic-forecasts",
  gdp: "economic-forecasts",
  unemployment: "economic-forecasts",
  inflation: "economic-forecasts",
  immigration: "migration",
  "net-migration": "migration",
  housing: "housing",
  "health-system": "health",
  hospital: "health",
};

// Keyword buckets: the triage fingerprint's domain is often null, and the
// core then carries free text ("225,000 people dead... covid-19"). Without
// bucketing every claim fragments into its own registry key and discoveries
// never amortise. A bucket fires when the normalised text CONTAINS a keyword
// — category-level, so all covid-mortality claims share one registry key.
const KEYWORD_BUCKETS: Array<[string[], string]> = [
  [["covid", "coronavirus", "pandemic"], "covid-mortality"],
  [["crime", "criminal", "victimisation", "offending"], "crime-statistics"],
  [["economy", "economic", "gdp", "inflation", "unemployment", "recession"], "economic-forecasts"],
  [["population", "census", "demographic", "immigration"], "population-estimates"],
  [["hospital", "health", "dhb", "waiting-list"], "health"],
  [["housing", "house-price", "rent"], "housing"],
  [["import", "export", "trade", "tariff"], "trade"],
  [["unemployment-benefit", "jobseeker", "wage-subsidy"], "welfare"],
];
const STOP_HEAD = new Set([
  "more",
  "than",
  "the",
  "a",
  "an",
  "of",
  "in",
  "if",
  "to",
  "there",
  "is",
  "are",
  "would",
  "we",
  "have",
  "because",
  "it",
  "its",
  "on",
  "at",
]);

export function canonicalDomain(raw: string): string {
  const normalised = normaliseDomain(raw);
  if (ALIASES[normalised]) return ALIASES[normalised];
  // Buckets fire on substring containment — before any key-size logic.
  const bucketed = KEYWORD_BUCKETS.find(([keys]) => keys.some((k) => normalised.includes(k)));
  if (bucketed) return bucketed[1];
  const words = normalised.split("-").filter(Boolean);
  if (words.length <= 4) return normalised; // already key-sized
  // Long free text: keep the first non-stopword head plus up to three
  // following words — the topical kernel of the sentence.
  let start = words.findIndex((w) => !STOP_HEAD.has(w));
  if (start < 0) start = 0;
  return words.slice(start, start + 4).join("-");
}
