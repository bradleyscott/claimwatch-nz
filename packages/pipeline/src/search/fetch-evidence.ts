// Evidence page fetch (user direction, Sept 2026): deep research reads pages,
// not just snippets. Bounded: timeout + size cap + text-only extraction.
// Failure degrades to snippet-only evidence — never throws into the verdict
// path (VER-R9 discipline: degraded is flagged, not silent).

export interface EvidenceText {
  ok: boolean;
  text: string;
}

const MAX_TEXT_CHARS = 4000;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchEvidenceText(
  url: string,
  fetchImpl: typeof globalThis.fetch = fetch,
  opts?: { snippet?: string; timeoutMs?: number },
): Promise<EvidenceText> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 8000);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { "user-agent": "claimwatch-evidence-fetch/0.1" },
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("text/html")) {
      return { ok: false, text: opts?.snippet ?? "" };
    }
    const html = await response.text();
    const text = stripHtml(html).slice(0, MAX_TEXT_CHARS);
    return text.length > 0 ? { ok: true, text } : { ok: false, text: opts?.snippet ?? "" };
  } catch {
    return { ok: false, text: opts?.snippet ?? "" };
  } finally {
    clearTimeout(timer);
  }
}
