// SIT-R12: feedback endpoint contract — schema rejects unexpected fields,
// rate limiting per client, email optional and never displayed, and no field
// that looks like claim submission (the intake surface stays closed).

import { describe, expect, it } from "vitest";
import {
  acceptFeedback,
  type FeedbackSink,
  feedbackRateLimited,
  parseFeedback,
} from "./feedback.ts";

const sink = (): FeedbackSink & {
  stored: Array<{ pageUrl: string; thumbs: string; text: string | null; email: string | null }>;
} => {
  const out: Array<{ pageUrl: string; thumbs: string; text: string | null; email: string | null }> =
    [];
  return {
    async store(record) {
      out.push(record);
    },
    get stored() {
      return out;
    },
  };
};

describe("feedback schema (SIT-R12)", () => {
  it("accepts the three-field shape with optional email", () => {
    const parsed = parseFeedback({
      page_url: "/claim/c1",
      thumbs: "up",
      text: "useful",
      email: "a@b.nz",
    });
    expect(parsed.thumbs).toBe("up");
  });

  it("rejects unexpected fields — the abuse surface is structurally closed", () => {
    expect(() =>
      parseFeedback({ page_url: "/x", thumbs: "up", claimed_verdict: "supported is wrong" }),
    ).toThrow(/rejected/);
    expect(() => parseFeedback({ page_url: "/x", thumbs: "sideways" })).toThrow(/rejected/);
    expect(() =>
      parseFeedback({ page_url: "/x", thumbs: "up", submit_a_claim: "please check this" }),
    ).toThrow(/rejected/);
  });

  it("treats email as optional; empty string is allowed and stored as null", () => {
    const noEmail = parseFeedback({ page_url: "/x", thumbs: "down" });
    expect(noEmail.email).toBeUndefined();
    const empty = parseFeedback({ page_url: "/x", thumbs: "down", email: "" });
    expect(empty.email).toBe("");
  });
});

describe("rate limiting (SIT-R12)", () => {
  it("allows five per minute then blocks", () => {
    const key = "client-A";
    for (let i = 0; i < 5; i++) {
      expect(feedbackRateLimited(key, 1_000 + i)).toBe(false);
    }
    expect(feedbackRateLimited(key, 2_000)).toBe(true);
  });

  it("a new window resets the count", () => {
    expect(feedbackRateLimited("client-B", 5_000)).toBe(false);
    expect(feedbackRateLimited("client-B", 5_000 + 61_000)).toBe(false);
  });
});

describe("acceptFeedback end-to-end", () => {
  it("stores the record with email optional and never displayed", async () => {
    const store = sink();
    await acceptFeedback(
      store,
      { page_url: "/claim/c1", thumbs: "up", email: "voter@example.nz" },
      "client-1",
    );
    expect(store.stored[0]).toMatchObject({
      pageUrl: "/claim/c1",
      thumbs: "up",
      email: "voter@example.nz",
    });
  });

  it("blocks the sixth submission in a window", async () => {
    const store = sink();
    for (let i = 0; i < 5; i++) {
      await acceptFeedback(store, { page_url: "/x", thumbs: "up" }, "client-spam");
    }
    await expect(
      acceptFeedback(store, { page_url: "/x", thumbs: "up" }, "client-spam"),
    ).rejects.toThrow(/rate limit/);
  });
});
