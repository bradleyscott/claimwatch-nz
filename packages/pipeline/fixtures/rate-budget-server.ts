// Rate-budget harness fixture server: a Bun HTTP server with scripted
// responses + request counting, so lane fetch tests assert bounded retries
// (429, 5xx, bot-wall 200) WITHOUT any live egress (CRO-R6).
// Test helper — implemented with the shared lane shape batch.

export interface RateBudgetScript {
  /** Ordered responses per request; the last one repeats. */
  responses: Array<{ status: number; body?: string; headers?: Record<string, string> }>;
}

export interface RateBudgetServer {
  url: string;
  stop(): Promise<void>;
  requestCount(): number;
}

export function startRateBudgetServer(port: number, script: RateBudgetScript): Promise<RateBudgetServer> {
  throw new Error("not implemented — Ingestion phase");
}