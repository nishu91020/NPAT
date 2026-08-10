# Which model, at what cost, with what failure modes

Type: research
Status: resolved

## Question

Which model available on Microsoft Foundry suits this workload — a latency-sensitive word-game
judge needing real-world knowledge and strict JSON, plus a low-frequency creative generator? What
does it cost at our volume? What changes when moving a Gemini prompt to an OpenAI-style model? How
do we verify quality before switching, and what are the realistic runtime failure modes?

## Answer

Full report: [research/02-model-cost-reliability.md](../research/02-model-cost-reliability.md)

**Model recommendation.** `gpt-4.1-mini` for the Judge — the balance of world knowledge (it must
know that *Nilgai* is an animal and *Samosa* is Indian food), latency, strict structured output, and
price. `gpt-5-mini` is the fallback if quota or region blocks it. For the bonus generator,
`gpt-4.1-nano` — the task is creative, not knowledge-dense, and it runs at most once a day thanks to
the per-date cache.

Open-weight models were ruled out, not on price but because they cannot guarantee strict structured
output on this endpoint surface. A malformed response while the player watches a "Verifying
Answers..." spinner is exactly the failure class strict mode eliminates.

**Cost.** ~$0.52 per 1,000 judge rounds on `gpt-4.1-mini`; ~$0.13 on `gpt-4.1-nano`. The bonus
generator is noise-floor — fractions of a cent per month. **Cost is not a real decision input at
this scale**; quality and latency are. Structuring messages so the fixed persona sits in a stable
`system` prefix enables input caching, cutting input cost ~75%.

*(Prices are from secondary sources — see the uncertainty flagged in
[Which SDK and how to guarantee structured JSON](01-research-sdk-structured-output.md).)*

**Prompt portability.** Gemini takes one `contents` string; OpenAI-style takes a messages array. The
fixed persona and rules become the `system` message, the per-round data becomes the `user` message —
which both reads better and maximises the cacheable prefix. The `Type`-enum schema becomes plain
JSON Schema with the strict-mode constraints noted in ticket 01.

**Quality validation.** A golden set of 100–200 answer-sets with known-correct rulings, diffed
between providers, targeting ≥95% agreement on clear-cut cases. Foundry has an evaluation SDK, but
for a solo developer a plain diff harness is the low-effort path.

**Failure modes — the important new one.** Azure applies **content filtering by default, on input as
well as output**, across hate/sexual/violence/self-harm. Players type arbitrary words into this
game, so this is a live concern rather than a theoretical one:
- A player entering a slur gets blocked before the model sees it — arguably free moderation.
- False positives are possible, especially on non-English words, and single-word answers give the
  filter little context.
- Blocked content returns **HTTP 400 with `code: "content_filter"`**, which is *not* retryable and
  must be handled distinctly from a transient error.
- Thresholds can be raised to "high only" in the portal; filtering cannot be fully disabled without
  a Microsoft approval process.

Other modes: 429 rate limits and 5xx are **auto-retried by the SDK** with backoff (`maxRetries: 3`
suggested). Global Standard has no cold starts. A model refusal surfaces as `finish_reason` on a 200
response and needs explicit handling.
