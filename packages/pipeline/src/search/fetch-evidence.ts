// Evidence fetch: deep research reads pages and DATA, not just snippets.
// Bounded: timeout + size cap + text extraction. Failure degrades to
// snippet-only evidence — never throws into the verdict path (VER-R9 discipline:
// degraded is flagged, not silent).
//
// WHY NON-HTML IS ACCEPTED. The primary record for a statistical claim is very
// often not a page: it is a CSV, a JSON endpoint, an XML feed or a plain-text
// table. Refusing anything but `text/html` made the record unreachable by
// construction — the researcher could find the dataset and still never read it.
// Anything text-based is now read; only genuinely binary formats are refused, and
// they are refused EXPLICITLY (`reason: "binary"`) so a caller can tell "this file
// is the wrong kind" from "this page failed" and go looking for another form of
// the same record.

export type FetchFailureReason =
  | "http-error"
  | "block-page"
  | "binary"
  | "empty"
  | "timeout"
  /** The request never produced a response (DNS, TLS, reset, refused). */
  | "transport";

export interface EvidenceText {
  ok: boolean;
  text: string;
  /** The response's content type, when it sent one. */
  contentType?: string;
  /** Why the fetch failed. Absent when `ok`. */
  reason?: FetchFailureReason;
}

/** HTML is stripped to text; everything else text-based is passed through. */
const MAX_TEXT_CHARS = 4000;
/** Data files get more room: a CSV's header and early rows are the useful part. */
const MAX_DATA_CHARS = 12_000;

/** How the fetch layer can read a response body. */
export type FetchedKind = "html" | "text" | "binary";

/**
 * Classify a content type. `text/*` is text by definition; JSON and XML arrive
 * under `application/*`, and both are readable data rather than opaque bytes.
 */
export function kindOfContentType(contentType: string): FetchedKind {
  const type = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  if (type === "text/html" || type === "application/xhtml+xml") return "html";
  if (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/x-ndjson" ||
    type === "application/xml" ||
    type.endsWith("+json") ||
    type.endsWith("+xml")
  ) {
    return "text";
  }
  return "binary";
}

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

/**
 * Bot-protection and interstitial pages that arrive with a 200 and a `text/html`
 * content type, so the fetch cannot tell them from a real page by status alone.
 *
 * They are worse than a failed fetch: the page has text, so the extractor finds a
 * passage in it and the block notice ("Request unsuccessful. Incapsula incident
 * ID: …") is stored as evidence. A refusal has to read as a refusal.
 */
const BLOCK_PAGE_SIGNATURES = [
  /incapsula incident id/i,
  /request unsuccessful/i,
  /just a moment\.\.\./i,
  /attention required/i,
  /access denied/i,
  /pardon our interruption/i,
  /enable javascript and cookies to continue/i,
  /verify you are human/i,
  /checking your browser/i,
  /unusual traffic/i,
  /cf-error-details/i,
];

/** True when the fetched text is a bot-protection or interstitial page, not content. */
export function looksLikeBlockPage(text: string): boolean {
  return BLOCK_PAGE_SIGNATURES.some((signature) => signature.test(text));
}

export async function fetchEvidenceText(
  url: string,
  fetchImpl: typeof globalThis.fetch = fetch,
  opts?: { snippet?: string; timeoutMs?: number },
): Promise<EvidenceText> {
  const snippet = opts?.snippet ?? "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 8000);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { "user-agent": "claimwatch-evidence-fetch/0.1" },
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      return { ok: false, text: snippet, contentType, reason: "http-error" };
    }
    const kind = kindOfContentType(contentType);
    if (kind === "binary") {
      // Explicit, so a caller can go looking for another form of the same record.
      return { ok: false, text: snippet, contentType, reason: "binary" };
    }

    const body = await response.text();
    if (kind === "html") {
      const text = stripHtml(body).slice(0, MAX_TEXT_CHARS);
      // A block notice has text, so it would otherwise be extracted as evidence.
      if (looksLikeBlockPage(text)) {
        return { ok: false, text: snippet, contentType, reason: "block-page" };
      }
      return text.length > 0
        ? { ok: true, text, contentType }
        : { ok: false, text: snippet, contentType, reason: "empty" };
    }

    // Text, CSV, JSON, XML: passed through untouched. HTML-stripping a CSV would
    // eat any field containing angle brackets and collapse its whitespace.
    const text = body.slice(0, MAX_DATA_CHARS);
    if (looksLikeBlockPage(text)) {
      return { ok: false, text: snippet, contentType, reason: "block-page" };
    }
    return text.trim().length > 0
      ? { ok: true, text, contentType }
      : { ok: false, text: snippet, contentType, reason: "empty" };
  } catch (error) {
    const aborted = (error as { name?: string }).name === "AbortError";
    // Always carry a reason: a silent failure is indistinguishable from an empty
    // page, and the caller cannot then tell whether to retry or look elsewhere.
    return { ok: false, text: snippet, reason: aborted ? "timeout" : "transport" };
  } finally {
    clearTimeout(timer);
  }
}
