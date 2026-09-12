// Feedback endpoint (SITE-MVP §2.4): the site's ONLY write path. Rate-limited
// per client, strict schema (unexpected fields rejected), email optional and
// never displayed, and no claim-submission intake surface (SIT-R12).

import { NextResponse } from "next/server";
import { acceptFeedback, type FeedbackSink } from "@/lib/feedback";

export const dynamic = "force-dynamic";

// In-memory sink for the slice; the durable feedback table lands with the
// deployment slice via the same interface.
const sink: FeedbackSink = {
  async store() {
    // Deployment slice: INSERT INTO feedback — append-only, never displayed raw.
  },
};

export async function POST(request: Request): Promise<Response> {
  const forwardedFor = request.headers.get("x-forwarded-for") ?? "local";
  const clientKey = forwardedFor.split(",")[0]?.trim() ?? "unknown";
  try {
    const body = await request.json();
    await acceptFeedback(sink, body, clientKey);
    return new Response(null, { status: 201 });
  } catch (e) {
    const message = (e as Error).message;
    const status = message.includes("rate limit") ? 429 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
