// Evidence page fetch: deep research reads the
// pages, not just the snippets. Bounded fetch — size cap + timeout — with
// text extraction. Failures degrade to snippet-only evidence, never throw
// into the verdict path.
//
// Authored BEFORE implementation (TDD red). The non-HTML case was widened by an
// approved change: a CSV/JSON/XML record is readable, and only genuinely binary
// formats are refused.

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

  it("refuses a binary file EXPLICITLY, so a caller can look for another form", async () => {
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
    expect(out.reason).toBe("binary");
  });
});

describe("data files are the record too, not just pages", () => {
  const respond = (body: string, contentType: string) =>
    (async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": contentType },
      })) as unknown as typeof globalThis.fetch;

  it("reads a CSV untouched — commas and line breaks intact", async () => {
    const csv = "year,victimisations\n2018,12000\n2023,18000\n";
    const out = await fetchEvidenceText("https://policedata.nz/x.csv", respond(csv, "text/csv"));
    expect(out.ok).toBe(true);
    expect(out.text).toBe(csv);
    expect(out.contentType).toBe("text/csv");
  });

  it("accepts a charset parameter on the content type", async () => {
    const out = await fetchEvidenceText(
      "https://x.govt.nz/a.csv",
      respond("a,b\n1,2\n", "text/csv; charset=utf-8"),
    );
    expect(out.ok).toBe(true);
  });

  it("reads JSON and XML, which arrive as application/*", async () => {
    const json = await fetchEvidenceText(
      "https://api.example.org/series",
      respond('{"value":12}', "application/json"),
    );
    expect(json.ok).toBe(true);
    expect(json.text).toBe('{"value":12}');
    const xml = await fetchEvidenceText(
      "https://example.org/feed",
      respond("<rss><item>12</item></rss>", "application/rss+xml"),
    );
    expect(xml.ok).toBe(true);
  });

  it("does NOT html-strip data: angle brackets and spacing survive", async () => {
    const body = 'expr,value\n"a<b",1\n';
    const out = await fetchEvidenceText("https://x.example/a.csv", respond(body, "text/plain"));
    expect(out.text).toBe(body);
  });

  it("gives data files more room than a page, still capped", async () => {
    const out = await fetchEvidenceText(
      "https://x.example/big.csv",
      respond("row\n".repeat(20000), "text/csv"),
    );
    expect(out.text.length).toBeGreaterThan(4000);
    expect(out.text.length).toBeLessThanOrEqual(12000);
  });

  it("carries a reason when the request never produced a response", async () => {
    const failing = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    const out = await fetchEvidenceText("https://dead.example/x", failing);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("transport");
  });

  it("still refuses a block notice that arrives as plain text", async () => {
    const out = await fetchEvidenceText(
      "https://x.example/b.txt",
      respond("Request unsuccessful. Incapsula incident ID: 123", "text/plain"),
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("block-page");
  });
});

describe("bot-protection pages", () => {
  it("treats a block notice as a failed fetch, not as content", async () => {
    // These arrive with 200 + text/html, so only the text reveals the refusal.
    const block = async () =>
      ({
        ok: true,
        headers: { get: () => "text/html" },
        text: async () =>
          "<html><body><META NAME='robots' CONTENT='noindex'><h1>Request unsuccessful. Incapsula incident ID: 364000540057122371-160590</h1></body></html>",
      }) as unknown as Response;
    const result = await fetchEvidenceText("https://www.beehive.govt.nz/release/x", block as never);
    expect(result.ok).toBe(false);
    expect(result.text).toBe("");
  });

  it("still accepts a real page", async () => {
    const real = async () =>
      ({
        ok: true,
        headers: { get: () => "text/html" },
        text: async () => "<html><body><p>Victimisations rose 12 percent.</p></body></html>",
      }) as unknown as Response;
    const result = await fetchEvidenceText("https://www.police.govt.nz/x", real as never);
    expect(result.ok).toBe(true);
    expect(result.text).toContain("Victimisations rose 12 percent");
  });
});
