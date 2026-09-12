// Mode routing (user direction, Sept 2026): open-web is the DEFAULT
// verification path. stat-grid fires only on an authority-registry hit for the
// claim's canonical domain; everything else — including statistical claims in
// unregistered categories — routes to the capped open-web loop. Discovery runs
// non-blocking alongside so later claims upgrade to stat-grid.

import { canonicalDomain } from "@cw/store";

export type VerificationMode =
  | "stat-grid"
  | "citation-check"
  | "quote-fidelity"
  | "provenance"
  | "open-web";

export interface RegistryProbe {
  resolveAuthority(domain: string): Promise<{ authorityRef: string; tier: number } | null>;
}

// Static modes keep their lane; only "statistical" is registry-dependent.
function staticMode(claimType: string): VerificationMode | null {
  switch (claimType) {
    case "citation-backed":
    case "institution-citation":
      return "citation-check";
    case "broadcast-quote":
      return "quote-fidelity";
    case "false-context":
      return "provenance";
    case "other":
      return "open-web";
    default:
      return null;
  }
}

export async function routeMode(
  input: { claimType: string; domain: string | null },
  registry: RegistryProbe,
): Promise<VerificationMode> {
  const staticResult = staticMode(input.claimType);
  if (staticResult != null) return staticResult;

  // statistical: registry hit (vetted authority for the canonical domain)
  // unlocks the stat-grid; a miss routes to open-web — the capped, labelled
  // default — while discovery populates the registry for later claims.
  if (input.domain == null) return "open-web";
  const authority = await registry.resolveAuthority(canonicalDomain(input.domain));
  return authority != null ? "stat-grid" : "open-web";
}
