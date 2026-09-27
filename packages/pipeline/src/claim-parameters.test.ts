// Claim parameters (ADR-0023): the typed parse that replaced the fingerprint.
//
// These pin the two bugs the fingerprint's free-text fields caused, because both
// were silent — they produced a plausible verdict rather than an error, and the
// fixtures had been written in the one format the parsing assumed.

import { describe, expect, it } from "vitest";
import {
  ClaimParameters,
  type ClaimParametersLlm,
  claimParametersFromLlm,
  emptyClaimParameters,
} from "./claim-parameters.ts";

function llmReturning(value: unknown): ClaimParametersLlm {
  return {
    async generateObject() {
      return { ok: true, value };
    },
  };
}

describe("claim parameters parse window and magnitude (ADR-0023)", () => {
  it("reads a window written as a range, which the fingerprint regex could not", () => {
    // THE BUG. The grid read its window start with
    // `/(?:since|from)\s+(\d{4})/i` over a free-text field. A claim parsed as
    // "2017-2026" — the phrasing the design's own worked example used — produced
    // a null start, no cited-window row, and an abstention, and every fixture
    // happened to say "since 2017" so nothing caught it. A typed `between` window
    // has a start by construction.
    const parsed = ClaimParameters.parse({
      window: { kind: "between", start: "2017", end: "2026", raw: "2017-2026" },
      quantity: { kind: "percent-change", value: 30, raw: "up 30%" },
    });
    expect(parsed.window.kind).toBe("between");
    expect(parsed.window.start).toBe("2017");
  });

  it("distinguishes 'no magnitude stated' from 'magnitude we could not read'", () => {
    // THE SECOND BUG. `parseQuantity` took the first number out of a string, so
    // the two cases collapsed into one null and both took the direction path —
    // which can return "supported" on direction alone. `kind` now separates them,
    // and the figures procedure abstains on the second.
    const directionOnly = ClaimParameters.parse({
      window: { kind: "since", start: "2017", end: null, raw: "since 2017" },
      quantity: { kind: "direction-only", value: null, raw: "crime is rising" },
    });
    const unreadable = ClaimParameters.parse({
      window: { kind: "since", start: "2017", end: null, raw: "since 2017" },
      quantity: { kind: "percent-change", value: null, raw: "up a third" },
    });
    expect(directionOnly.quantity.kind).toBe("direction-only");
    expect(unreadable.quantity.kind).toBe("percent-change");
    expect(unreadable.quantity.value).toBeNull();
  });

  it("keeps the claim's own words alongside the parse", () => {
    // The raw text is the auditable artefact: "up 30%", "up a third" and "more
    // than 30%" are not the same claim, and a derived number with no source text
    // cannot be checked against the sentence.
    const parsed = ClaimParameters.parse({
      window: { kind: "since", start: "2017", end: null, raw: "since the last election" },
      quantity: { kind: "percent-change", value: null, raw: "up a third" },
    });
    expect(parsed.quantity.raw).toBe("up a third");
  });

  it("rejects a window year that is not a four-digit year", () => {
    // A guessed start is worse than an unstated one: it silently compares the
    // claim against a period nobody claimed.
    expect(() =>
      ClaimParameters.parse({
        window: { kind: "since", start: "the last election", end: null, raw: "x" },
        quantity: { kind: "none", value: null, raw: "" },
      }),
    ).toThrow();
  });

  it("throws on an unparseable response rather than degrading the claim", () => {
    // The old stage degraded the claim's TYPE to `other`, silently rerouting it to
    // a different check. Failing here leaves that decision to the caller, which
    // abstains instead.
    const llm: ClaimParametersLlm = {
      async generateObject() {
        return { ok: false, failureClass: "schema-validation" };
      },
    };
    return expect(claimParametersFromLlm(llm, { sentence: "x" })).rejects.toThrow(
      /claim parameter extraction failed/,
    );
  });

  it("exposes an empty parse for a claim with nothing to extract", () => {
    const empty = emptyClaimParameters();
    expect(empty.window.kind).toBe("unstated");
    expect(empty.quantity.kind).toBe("none");
  });

  it("round-trips through the LLM port", async () => {
    const llm = llmReturning({
      window: { kind: "since", start: "2017", end: "2026", raw: "since 2017" },
      quantity: { kind: "percent-change", value: 30, raw: "up 30%" },
    });
    const parsed = await claimParametersFromLlm(llm, { sentence: "Crime is up 30% since 2017." });
    expect(parsed.window.start).toBe("2017");
    expect(parsed.quantity.value).toBe(30);
  });
});
