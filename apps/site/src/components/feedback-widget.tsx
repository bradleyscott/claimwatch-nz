"use client";

import React, { useState } from "react";

// Feedback widget (SITE-MVP §1 #6): fixed, dismissible; thumbs + free text +
// optional email. Feedback ABOUT THE SITE — there is deliberately no field that
// looks like claim submission (the submission slice comes later).

export function FeedbackWidget({ pageUrl }: { pageUrl: string }) {
  const [dismissed, setDismissed] = useState(false);
  const [thumbs, setThumbs] = useState<"up" | "down" | null>(null);
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  if (dismissed) {
    return null;
  }

  const submit = async () => {
    setState("sending");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page_url: pageUrl,
          ...(thumbs ? { thumbs } : {}),
          ...(text.length > 0 ? { text } : {}),
          ...(email.length > 0 ? { email } : {}),
        }),
      });
      if (response.status === 201) {
        setState("sent");
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setErrorMessage(body.error ?? "Something went wrong.");
      setState("error");
    } catch {
      setErrorMessage("Could not reach the feedback endpoint.");
      setState("error");
    }
  };

  if (state === "sent") {
    return (
      <div className="fixed bottom-4 left-4 z-50 rounded-xl border border-line bg-card px-4 py-3 text-[13px] shadow-sm">
        <span className="font-semibold">Thanks — noted.</span>
        <button className="ml-3 text-mut underline" onClick={() => setDismissed(true)}>
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 max-w-[340px] rounded-xl border border-line bg-card px-4 py-3 text-[13.5px] shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold">Was this page useful?</span>
        <button
          aria-label="Dismiss feedback"
          className="ml-3 text-faint hover:text-mut"
          onClick={() => setDismissed(true)}
        >
          ✕
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          aria-pressed={thumbs === "up"}
          className={`rounded-lg border border-line px-3 py-1.5 font-semibold ${thumbs === "up" ? "bg-[#e8f3ea]" : "bg-white"}`}
          onClick={() => setThumbs("up")}
        >
          👍 Yes
        </button>
        <button
          aria-pressed={thumbs === "down"}
          className={`rounded-lg border border-line px-3 py-1.5 font-semibold ${thumbs === "down" ? "bg-[#f8e9e7]" : "bg-white"}`}
          onClick={() => setThumbs("down")}
        >
          👎 Something's off
        </button>
      </div>
      {thumbs !== null ? (
        <div className="mt-2">
          <textarea
            aria-label="Tell us more (optional)"
            className="w-full rounded-lg border border-line p-2 text-[13px]"
            placeholder="Anything more to add? (optional)"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <input
            aria-label="Your email (optional, never displayed)"
            className="mt-2 w-full rounded-lg border border-line p-2 text-[13px]"
            placeholder="Email (optional)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            className="mt-2 w-full rounded-lg bg-link py-2 font-semibold text-white"
            onClick={submit}
            disabled={state === "sending"}
          >
            {state === "sending" ? "Sending…" : "Send feedback"}
          </button>
          {state === "error" ? (
            <p className="mt-2 text-[12px] text-[#c0392b]" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
