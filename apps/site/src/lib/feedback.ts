// Feedback widget contract (SIT-R12): thumbs + free text + optional email.
// NOT a claim-submission intake — no field that looks like "submit a claim".
// Rate-limited; email optional, never displayed; schema rejects unexpected
// fields (abuse surface structurally closed).

import { z } from "zod";

export const FeedbackSubmission = z
  .object({
    page_url: z.string().min(1).max(500),
    thumbs: z.enum(["up", "down"]),
    text: z.string().max(2000).optional(),
    email: z.union([z.literal(""), z.string().email()]).optional(),
  })
  // Unexpected fields REJECTED, not stripped (SIT-R12): the abuse surface is
  // structurally closed, and no field can smuggle in claim intake.
  .strict();
export type FeedbackSubmission = z.infer<typeof FeedbackSubmission>;

export function parseFeedback(raw: unknown): FeedbackSubmission {
  const result = FeedbackSubmission.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`feedback rejected at ${issue?.path.join(".")}: ${issue?.message}`);
  }
  return result.data;
}

// Fixed-window in-memory limper for the slice (single container); a real
// distributed limiter is operations-hardening, not MVP.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const seen: Map<string, { windowStart: number; count: number }> = new Map();

export function feedbackRateLimited(clientKey: string, now = Date.now()): boolean {
  const entry = seen.get(clientKey);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    seen.set(clientKey, { windowStart: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

// Storage seam: the feedback table is the site's ONLY write (SITE-MVP §3.1).
export interface FeedbackRecord {
  pageUrl: string;
  thumbs: "up" | "down";
  text: string | null;
  email: string | null;
  receivedAt: Date;
}

export interface FeedbackSink {
  store(record: {
    pageUrl: string;
    thumbs: "up" | "down";
    text: string | null;
    email: string | null;
  }): Promise<void>;
}

export async function acceptFeedback(
  sink: FeedbackSink,
  raw: unknown,
  clientKey: string,
): Promise<{ accepted: true }> {
  if (feedbackRateLimited(clientKey)) {
    throw new Error("feedback rate limit exceeded — try again in a minute");
  }
  const parsed = parseFeedback(raw);
  // Email is never displayed (SIT-R12); stored only for optional follow-up.
  await sink.store({
    pageUrl: parsed.page_url,
    thumbs: parsed.thumbs,
    text: parsed.text ?? null,
    email: parsed.email ? parsed.email : null,
  });
  return { accepted: true };
}
