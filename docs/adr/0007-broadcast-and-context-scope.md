# ADR-0007: Broadcast and podcast interviews — the context-scope boundary

*Status: Proposed · Date: 2026-09-08 · Deciders: Bradley, Dave*

*(Consolidates the broadcast/podcast ingestion decision with the self-generated-transcription scope boundary.)*

## Context

A large share of campaign claims is made in spoken interviews — TV, radio, and podcasts — not in releases or news text: the weekly leader-interview circuit on radio, daily talkback panels ("The Huddle", "Perspective"), podcast interviews, and the five scheduled 2026 debates (1 Oct Stuff multi-party; 6 Oct TVNZ leaders; 13 Oct TVNZ multi-party; 14 Oct NZH/ZB/Three leaders; 20 Oct Stuff leaders). The ingestion ADR (ADR-0006) initially deferred broadcast transcription wholesale. Two questions precede any decision to transcribe: **how much claim-bearing speech is there, and are published transcripts already available?** This ADR answers both with live probes (2026-09-08) and sets the access strategy.

**Probing result — the transcripts-first finding:** the intuition that transcription is necessary turns out to be mostly wrong, because the interview circuit **already produces published text in three overlapping channels**, and the highest-claim-density interview content is on YouTube, where **auto-generated caption tracks are available for essentially every video** (verified: Q+A, 1News, Newstalk ZB, RNZ uploads all carry `captionTracks` with English ASR). Full ASR self-hosting is the *fallback* for the residual gap, not the primary mechanism.

## Decision

**A transcripts-first broadcast lane: ingest only text published by others (web articles, broadcaster-uploaded YouTube caption tracks). Any source requiring US to generate a transcript is OUT OF SCOPE — our own ASR risks fabricating claims that were never made, and that failure mode is disqualifying until its accuracy is measured on our own audio.**

### The claim-bearing volume, mapped

| Forum | Volume (2026 campaign) | Published text? | Access path |
|---|---|---|---|
| **RNZ Morning Report / Nine to Noon / Focus on Politics** | ~15–25 political segments/day (radio); leader interview weekly 8:08am; commentators 3×/week | **Partial — per-segment audio items carry a 30–40-word summary only; written stories exist for news items (~16/day in the political RSS), not interview transcripts** | (a) written news items via the existing RSS lane; (b) segment-level MP3s via programme podcast RSS (verified: 711 Morning Report / 274 Nine to Noon / 265 Focus on Politics episodes, direct URLs, no bot protection); (c) **YouTube uploads carry auto-captions** — caption harvest is the transcripts-first path |
| **Newstalk ZB** (Hosking Breakfast, HdPA Drive, Huddle, weekend shows) | Daily political shows; per-item audio pages (no transcripts; no raw feed) | Summary text only (~200 words/item) | **YouTube channel (5,151 videos) with ASR caption tracks** (verified) — captions-first; per-page audio as fallback |
| **TV: 1News, Q+A, Breakfast, Seven Sharp** | Daily political interviews; Q+A weekly (38.8k subs, 1,328 videos) | **No published transcripts** (TVNZ pages checked — none) | **1News YouTube (11,495 videos) carries ASR caption tracks** (verified) — the practical transcript source for TV interviews |
| **Election debates (5 scheduled, Oct)** | 5 events, the highest-stakes claims of the campaign (s 199A) | None | YouTube captions if uploaded; else **manual labelling of debate claims** (n small — 5 events) |
| **Independent podcasts** (The Spinoff, NZ Initiative, Politics NZ, etc.) | Weekly shows | Some publish write-ups | Standard podcast RSS (same mechanism as RNZ), or captions if uploaded to YouTube |

### Transcript tiers — trust tracks who produced the text

1. **Human-reviewed publisher transcripts** — text the publisher (or video creator) prepared and reviewed for publication: written news items, ZB page summaries of their own shows, RNZ articles, creator-uploaded YouTube captions (the "English" track *without* the "auto-generated" marker). Highest trust: a human took responsibility for the wording. **Strong claim sources — the wording can be treated as what was said** (still quote-minimally, still attributed, still linked).
2. **Machine-generated publisher captions** — YouTube auto-captions (`kind: "asr"`): the *broadcaster* published them, but a third-party ASR system generated them **without human review**. A claim source, not a trustworthy wording record — subject to the caption-quality flag and the guardrails below.
3. **Self-generated transcription** — out of scope (below).

The distinction matters exactly as Bradley framed it: a publisher's own reviewed transcript carries editorial accountability; YouTube's auto-track is an unreviewed ASR output that merely happens to sit on the broadcaster's page. Trusting it at the level of reviewed text would import the same fabrication risk we just excluded from our own pipeline.

### The caption path: tiered trust, not blanket trust

Caption provenance is checked, not assumed: the harvest records from the track's own metadata whether the English track is creator-uploaded (manual — tier 1) or auto-generated (`kind: "asr"` — tier 2). Creator-uploaded tracks are detected automatically and raise the claim's transcript-trust tier.

- **Tier-1 claims**: usable as reliable claim wording; the transcript-trust field records "publisher-reviewed"; no caption-quality flag required (provenance still names the source).
- **Tier-2 claims** carry the full guardrail set below.

Caveats, honestly stated:

- **Auto-generated caption accuracy is ~85–95%** (clean studio audio) — good enough for **claim detection and retrieval**, not sufficient to assert a *quoted figure* is wrong because the caption misquotes it. Design response: **tier-2 captions are a claim pointer, never the evidence for a number** — numerical claims sourced from them are verified against official series anyway (the stat engine doesn't need the transcript to be the evidence), and citation-checks re-fetch the underlying source. A caption-quality flag rides on every tier-2 caption-derived claim, and claims whose *quoted text itself* matters get the conservative "verification limited to the quoted claim" treatment.
- **Timestamp anchoring is mandatory for every caption/video-derived claim.** Because we rely on third-party captions rather than our own transcription, the reader must be able to verify the wording against the actual audio/video in one click. The claim record stores: **utterance start and end times** (from the caption track's own timestamps, plus/minus a small context pad), the **source video/audio URL**, and a deep link resolving to those times (YouTube `t=`/`end=` parameters; native player deep-links for others). The verdict page renders the claim alongside a **"hear it / watch it"** control for the exact utterance — this is what keeps a caption-derived claim from being a dead-end assertion. Extraction treats caption timestamps as first-class metadata (VTT/SRT cues carry them natively), and the claim record's provenance includes the cue span so reprocessing can re-pull the same cue after caption revisions.
- **Where the source is a written article covering a broadcast item**, the link goes to the item page containing the audio/video embed, with the segment identified by the item's own segmentation (RNZ publishes segments individually; ZB items are per-segment) — every claim points to playable media at (or near) the utterance.
- **YouTube ToS prohibits bulk automated access** outside official APIs. Posture: low-volume, read-only, public-page access of caption tracks for specific broadcast items (single-digit requests/day), following robots.txt posture, no redistribution of caption files — consistent with how we treat publisher sites. If challenged, the fallback is the same content via self-hosted ASR of the same public audio.

### Self-generated transcription: OUT OF SCOPE

**The concern:** ASR errors do not merely misquote claims — they can **define claims that were never made**. A hallucinated or mis-heard statistic entering the claim corpus means the pipeline fact-checks something nobody said, and a verdict page attributes to a person a claim they did not make. For a system whose credibility model is "we checked what was actually claimed, with evidence," that is the worst possible failure mode — worse than missing claims, worse than low coverage. It is also defamation-adjacent (ADR-0002): attributing an unmade claim to a named person is precisely the harm the claims-not-persons standard exists to avoid.

**Decision: no self-generated transcription in v1.** Any source where we would have to run our own ASR (segment-level MP3s with no YouTube captions and no web text — e.g. some Newstalk ZB page audio, RNZ audio items without YouTube uploads) is **out of scope** until ASR accuracy is measured on our own audio and meets a published bar.

- **The re-entry bar, defined now**: a hand-checked NZ interview sample (30+ segments, mixed speakers) transcribed by candidate engines; error profile published with per-claim-type analysis (numbers, names, te reo passages). Re-adoption requires WER low enough that fabrication risk is quantified and acceptable — and even then, ASR-sourced claims would carry a machine-transcription flag and the "never evidence for a quoted number" rule.
- **What remains in scope without ASR**: broadcaster-uploaded YouTube captions, ZB/RNZ written items, news RSS, Hansard, releases, submissions. The interview circuit's highest-claim-density content (TV clips, Q+A, ZB YouTube) is inside scope via captions.
- **What is deferred with it**: RNZ/ZB audio-only segments, podcasts without captions or write-ups, Parliament TV video, debate audio (debates fall back to captions if uploaded, else manual labelling).

### Amendment to ADR-0006

The blanket broadcast deferral is replaced with: **broadcast/podcast interview lane (transcripts-first, published-text-only)** — YouTube caption harvest for 1News/Q+A/ZB/RNZ clips + ZB page text + RNZ written items; self-generated transcription excluded from v1 scope; debate events handled explicitly (captions if uploaded, else manual labelling). Parliament TV bulk transcription stays deferred (Hansard covers chamber proceedings).

## Alternatives considered

- **Full self-hosted ASR over all broadcast audio (the original "transcribe everything" path).** Rejected: broadcaster-published captions already cover most of the volume, and self-generated transcription is out of scope entirely — not a fallback lane.
- **Self-hosted ASR for residual audio-only sources.** Rejected per Bradley: incorrect transcription can define claims that were never made — the worst failure mode in the system. Out of scope until measured on our own audio against the published re-entry bar (the NZ-accent evidence review below stays as the input to that future measurement).
- **Commercial transcription APIs** (gpt-4o-transcribe ~$0.36/hr, AssemblyAI ~$0.15/hr). Same fabrication-risk reasoning: the engine doesn't matter — *any* self-generated transcription carries the unmade-claim risk until measured. Out of scope for v1 on identical grounds; the pricing comparison is retained for that future decision.
- **Skipping broadcast entirely (keep the original deferral).** Rejected: unscripted interview speech is where the check-worthy claims actually happen, the debates are the highest-stakes claims of the campaign, and the published-text path (captions + web text) covers the highest-claim-density content without us generating any transcription.

### Comparative pricing for the deferred transcription decision (2026 published rates, verified)

At the deferred volume (~4–6 audio-hours/day ≈ 300 hours through the election window): self-hosted Whisper ≈ **$0** (electricity only); AssemblyAI Universal-2 ≈ **$45** total; gpt-4o-mini-transcribe ≈ **$54**; Google Chirp 2 dynamic-batch ≈ **$72** (24-hour turnaround); Deepgram Nova-3 ≈ **$78**; gpt-4o-transcribe ≈ **$108**. Paid-services ceiling for the whole window: **$45–108** — affordable, but self-hosting is free, keeps audio on our hardware (no egress), and adds speaker diarization via pyannote at no extra charge (AssemblyAI charges extra for its diarization tier; per-hour rates above are transcription-only).

### Accuracy for the NZ accent — what the evidence says (reviewed 2026-09-08)

- **NZ English is not separately benchmarked in any public leaderboard** — no vendor (Deepgram, AssemblyAI, OpenAI) publishes a NZ-specific WER, and the standard suites (LibriSpeech, Earnings22, GigaSpeech) are American-heavy. NZ-accented performance must be inferred from adjacent evidence.
- **Adjacent-accent evidence (Cambridge study, JASA 2024)**: across four native accents, Whisper performed best on American English, with statistically significant error-rate increases for British (β = 0.031, p < 0.001) and Australian English (β = 0.013, p = 0.016) relative to American; Canadian showed no significant difference. NZ English sits linguistically closer to Australian than American — expect a **modest degradation of the same order as Australia's**, implying an NZ-broadcast expectation of roughly **8–15% WER** for Whisper large-v3-class models (real-world English runs 8–12% generally; conversational multi-speaker interview audio sits at the upper end).
- **Model choice within Whisper matters**: large-v3 ranked #1 on EdAcc (40-accent conversational corpus); **large-v3-turbo ranked #2** — the speed-optimised Turbo loses little on accented English, and both beat every distilled variant. So the Turbo model chosen for cost reasons is not an accuracy compromise on NZ audio. NVIDIA Parakeet leads clean-English leaderboards but is English/European-only and less tested on accented conversational speech.
- **A NZ-specific data point exists**: Te Hiku Media's Kaituhi project (Northland) fine-tuned Whisper on bilingual te reo Māori / NZ-English speech (~125 hours) — stock Whisper's te reo performance was very poor (53–73% WER), and even fine-tuned bilingual models need <15% WER as the practical usability bar. **Implication:** any interview containing te reo passages will transcribe poorly on stock models. Māori-language claims are out of scope for v1 (per `SOURCE-TAXONOMY.md`), but NZ political speech routinely mixes te reo phrases into English — the design response is the caption-quality flag plus the "never evidence for a quoted number" rule (a mis-transcribed te reo phrase surfaces in claim detection, not in a verdict's evidence).
- **Vendor claims are suite-relative, not comparable** (Deepgram's 5.26% is on its proprietary set; AssemblyAI publishes English-only) — any real choice must be made **on our own audio**: a 30-segment NZ interview sample, hand-checked, scored per engine. A one-day harness task worth doing before the lane ships; it doubles as calibration data for the caption-quality flag.
- **YouTube auto-captions on NZ political content share this profile** — they're ASR too, so the ~85–95% caption-accuracy assumption inherits the same NZ-accent caution. The mitigation is already structural: captions are claim pointers, never evidence for quoted numbers.

**Bottom line:** no published NZ-specific WER exists; inferential evidence suggests Whisper large-v3-Turbo would land around 8–15% WER on NZ broadcast interview audio — at the top edge of human performance on clean audio, 1.5–2× human error on noisy multi-speaker audio. **That estimate is why self-generated transcription is out of scope, not why it is safe**: an 8–15% error rate on conversational audio, with unknown rates for the fabrication/hallucination class specifically, is not a measured basis for admitting machine-fabricated text into a claim corpus. The 30-segment local benchmark (the re-entry bar) is the task that would convert this inference into a measured, publishable number if transcription is ever reconsidered.

## Consequences

- **The transcript extractor joins the format-aware extraction set** (ADR-0006): caption VTT/SRT → speaker-turn-preserving text, feeding the same triage/verification pipeline as articles. **The extractor records transcript-trust provenance** (publisher-reviewed vs auto-generated vs, if ever admitted, machine-self-generated) as a first-class field on the claim record; attribution from captions is conservative (same never-guessed rule); no diarization is used (no ASR in scope). **Cue timestamps are extracted as first-class fields** — start/end seconds, media URL, deep-link — stored on the claim record and rendered on verdict pages as the "hear it / watch it" control. The store schema carries a `media_anchor` field (media_url, start_s, end_s, deep_link) plus a `transcript_tier` field (publisher-reviewed | publisher-auto | self-generated) for any claim sourced from audio/video-bearing documents; the same field types later serve Hansard audio references if those are ever added.
- **Caption-quality flag applies to tier-2 (auto-generated) claims only**: the verdict page states when a claim's wording rests on an unreviewed auto-generated caption (and links the video + timestamp for the reader to verify). Tier-1 claims name their provenance without the warning flag — the tier system is what stops reviewed text and raw ASR output being treated as equivalent.
- **Volume estimate for the lane**: ~20–40 caption items/day across the monitored channels, each a short document — cheap in triage cost, and the highest-value claims in the corpus.
- **Debate handling is a named build item** before October: captions-or-manual decision per debate, pre-registered claim list, fast-lane verification (electoral-process priority, ADR-0005).
- **Coverage is honestly narrower than the full broadcast landscape**: audio-only segments (some ZB page audio, RNZ segments without YouTube uploads, captionless podcasts) are out of scope and the site's methodology page says so — consistent with the project's pattern of naming gaps rather than papering over them.