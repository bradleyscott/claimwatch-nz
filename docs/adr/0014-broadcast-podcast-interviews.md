# ADR-0014: Broadcast and podcast interviews — transcripts-first; ASR only where nothing is published

*Status: Proposed · Date: 2026-09-08 · Deciders: Bradley, Dave*

## Context

A large share of campaign claims is made in spoken interviews — TV, radio, and podcasts — not in releases or news text: the weekly leader-interview circuit on radio, daily talkback panels ("The Huddle", "Perspective"), podcast interviews, and the five scheduled 2026 debates (1 Oct Stuff multi-party; 6 Oct TVNZ leaders; 13 Oct TVNZ multi-party; 14 Oct NZH/ZB/Three leaders; 20 Oct Stuff leaders). ADR-0002 deferred broadcast transcription wholesale. Two questions precede any decision to transcribe: **how much claim-bearing speech is there, and are published transcripts already available?** This ADR answers both with live probes (2026-09-08) and sets the access strategy.

**Probing result — the transcripts-first finding:** the intuition that transcription is necessary turns out to be mostly wrong, because the interview circuit **already produces published text in three overlapping channels**, and the highest-claim-density interview content is on YouTube, where **auto-generated caption tracks are available for essentially every video** (verified: Q+A, 1News, Newstalk ZB, RNZ uploads all carry `captionTracks` with English ASR). Full ASR self-hosting is the *fallback* for the residual gap, not the primary mechanism.

## Decision

**A transcripts-first broadcast lane: harvest published text (web articles, YouTube caption tracks) as the primary transcript source; self-hosted Whisper only for audio with no text path; treat transcripts as internal working documents with fair-dealing quotation on public pages.**

### The claim-bearing volume, mapped

| Forum | Volume (2026 campaign) | Published text? | Access path |
|---|---|---|---|
| **RNZ Morning Report / Nine to Noon / Focus on Politics** | ~15–25 political segments/day (radio); leader interview weekly 8:08am; commentators 3×/week | **Partial — per-segment audio items carry a 30–40-word summary only; written stories exist for news items (~16/day in the political RSS), not interview transcripts** | (a) written news items via the existing RSS lane; (b) segment-level MP3s via programme podcast RSS (verified: 711 Morning Report / 274 Nine to Noon / 265 Focus on Politics episodes, direct URLs, no bot protection); (c) **YouTube uploads carry auto-captions** — caption harvest is the transcripts-first path |
| **Newstalk ZB** (Hosking Breakfast, HdPA Drive, Huddle, weekend shows) | Daily political shows; per-item audio pages (no transcripts; no raw feed) | Summary text only (~200 words/item) | **YouTube channel (5,151 videos) with ASR caption tracks** (verified) — captions-first; per-page audio as fallback |
| **TV: 1News, Q+A, Breakfast, Seven Sharp** | Daily political interviews; Q+A weekly (38.8k subs, 1,328 videos) | **No published transcripts** (TVNZ pages checked — none) | **1News YouTube (11,495 videos) carries ASR caption tracks** (verified) — this is the practical transcript source for TV interviews |
| **Election debates (5 scheduled, Oct)** | 5 events, the highest-stakes claims of the campaign (s 199A) | None | YouTube captions if uploaded; else self-hosted ASR on the broadcast audio; **manual labelling of debate claims** as the highest-quality fallback (n small — 5 events) |
| **Independent podcasts** (The Spinoff, NZ Initiative, Politics NZ, etc.) | Weekly shows | Some publish write-ups | Standard podcast RSS (same mechanism as RNZ), or captions if uploaded to YouTube |

**Ordering principle:** published web text (RSS items, ZB page text) → YouTube ASR captions (the broadcaster's own published captions) → self-hosted Whisper only where neither exists.

### The YouTube caption path (verified available, with caveats)

Broadcasters upload interview clips to YouTube; auto-generated English captions exist on essentially all of them (probe confirmed `captionTracks` present with `kind: asr` across 1News, Q+A, ZB, RNZ videos). Harvesting captions (yt-dlp / timedtext) yields a transcript **already published by the broadcaster** — we are reading text the publisher put on their own page, not generating one. Legal posture: the same as reading their website (a source we may quote from under fair dealing); the transcript is used internally for claim extraction, and verdict pages quote minimally with attribution and a link to the source video.

Caveats, honestly stated:

- **Accuracy is ~85–95% WER** for clean studio auto-captions — good enough for **claim detection and retrieval**, not sufficient to assert a *quoted figure* is wrong because the caption misquotes it. Design response: **captions are a claim pointer, never the evidence for a number** — numerical claims sourced from captions are verified against official series anyway (the stat engine doesn't need the transcript to be the evidence), and citation-checks re-fetch the underlying source. A caption-quality flag rides on every caption-derived claim, and claims whose *quoted text itself* matters (what exactly was said) get the conservative "verification limited to the quoted claim" treatment.
- **YouTube ToS prohibits bulk automated access** outside official APIs. Posture: low-volume, read-only, public-page access of caption tracks for specific broadcast items (single-digit requests/day), following robots.txt posture, no redistribution of caption files — consistent with how we already treat publisher sites. If this posture is ever challenged, the fallback is the same content via self-hosted ASR of the same public audio.

### The residual ASR lane (only where nothing published exists)

Where an interview exists only as audio (e.g. ZB page audio with no YouTube upload), **Whisper large-v3-Turbo self-hosted on the homelab GPU** transcribes it: 1.6GB VRAM, ~80× real-time on an RTX 3090-class card — a day's segment intake (~4–6 hours audio) transcribes in minutes, cost ≈ $0. pyannote diarization adds speaker turns (the attribution signal). This lane is bounded: it processes only items whose sources have no published text — expected to be a minority once the caption lane is running.

### Amendment to ADR-0002

The blanket broadcast deferral is replaced with: **broadcast/podcast interview lane (transcripts-first)** — YouTube caption harvest for 1News/Q+A/ZB/RNZ clips + ZB page text + RNZ written items as primary; segment-level ASR as the bounded fallback; debate events handled explicitly (captions or manual labelling). Parliament TV bulk transcription stays deferred (Hansard covers chamber proceedings; debates are the only TV events worth manual attention).

## Alternatives considered

- **Full self-hosted ASR over all broadcast audio (the original "transcribe everything" path).** Rejected as primary: broadcaster-published captions already exist for most of the volume, cost nothing, and are already public; ASR is retained for the residual. The lane remains as fallback for sources with neither captions nor text.
- **Manual transcription of everything.** Rejected at daily volume; retained only for the five debate events (n small, stakes maximal, s 199A).
- **Commercial transcription APIs** (gpt-4o-transcribe ~$0.36/hr, AssemblyAI ~$0.15/hr). Rejected for the steady-state lane: caption harvesting is free and already-published; at ~4–6 audio-hours/day the API cost ($1–2/day) is affordable but unnecessary when the captions exist. Revisit only if the residual-no-transcript volume grows.
- **Skipping broadcast entirely (keep the ADR-0002 deferral).** Rejected: unscripted interview speech is where the check-worthy claims actually happen, the debates are the highest-stakes claims of the campaign, and the caption path makes the cost trivial compared to the original 2024-era assumption that this lane needed a transcription pipeline.

## Consequences

- **The transcript extractor joins the format-aware extraction set** (ADR-0011): caption VTT/SRT → speaker-turn-preserving text, feeding the same triage/verification pipeline as articles. Attribution from captions is conservative (same never-guessed rule); diarization only in the ASR fallback lane.
- **Caption-quality flag** on caption-derived claims: the verdict page states when a claim's wording rests on an auto-generated caption (and links the video for the reader to verify).
- **Volume estimate for the lane:** ~20–40 caption items/day across the monitored channels (segments, clips, interviews), each a short document — cheap in triage cost, and the highest-value claims in the corpus.
- **Debate handling is a named build item** before October: captions-or-manual decision per debate, pre-registered claim list, fast-lane verification (electoral-process priority, ADR-0010).