// Evidence page fetch (user direction, Sept 2026): deep research reads the
// pages, not just the snippets. Bounded fetch — size cap + timeout — with
// text extraction. Failures degrade to snippet-only evidence, never throw
// into the verdict path.
//
// Authored BEFORE implementation (TDD red). Do not mutate without approval.

import { describe, expect, it } from "vitest";
import { type EvidenceText, fetchEvidenceText } from "./fetch-evidence.ts";

function htmlResponse(body: string, status = 200): Response {
  return new Response(status === 200 ? htmlPage(body) : "nope", {
    status,
    headers: { "content-type": "text/html" },
  });
}

function htmlPage(text: string): string {
  return `<html><head><title>t</title><style>body{color:red}</style><script>var x=1;</script></head><body><main>${text}</main></body></html>`;
}

describe("evidence page fetch — read the page, not just the snippet", () => {
  it("extracts readable text from an HTML page, stripping scripts/styles/tags", async () => {
    const fakeFetch: typeof globalThis.fetch = async (url) => {
      void url;
      return htmlResponse(
        "India imported $14.2 billion from China in April-August 2020, a decline from 2019.",
      );
    };
    const out: EvidenceText = await fetchEvidenceText(
      "https://commerce-app.govt.in/stats",
      fakeFetch,
    );
    expect(out.ok).toBe(true);
    expect(out.text).toContain("$14.2 billion");
    expect(out.text).not.toContain("var x=1");
    expect(out.text).not.toContain("color:red");
    expect(out.text).not.toContain("<main>");
  });

  it("degrades gracefully: HTTP failure returns snippet-only evidence, never throws", async () => {
    const fakeFetch: typeof globalThis.fetch = async () => htmlResponse("", 403);
    const out = await fetchEvidenceText("https://blocked.example.com/page", fakeFetch, {
      snippet: "cached snippet text",
    });
    expect(out.ok).toBe(false);
    expect(out.text).toBe("cached snippet text");
  });

  it("caps extracted text length (cost guard)", async () => {
    const fakeFetch: typeof globalThis.fetch = async () => htmlResponse("word ".repeat(20000));
    const out = await fetchEvidenceText("https://huge.example.com/page", fakeFetch);
    expect(out.text.length).toBeLessThanOrEqual(4000);
  });

  it("non-HTML content types are skipped (PDF/images degrade to snippet)", async () => {
    const fakeFetch: typeof globalThis.fetch = async () =>
      new Response("%PDF-1.4 binary", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    const out = await fetchEvidenceText("https://files.example.com/report.pdf", fakeFetch, {
      snippet: "the snippet",
    });
    expect(out.ok).toBe(false);
    expect(out.text).toBe("the snippet");
  });
});
