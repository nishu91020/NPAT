# Decide how content-filter rejections behave

Type: grilling
Status: resolved
Blocked by: 02

## Question

Azure applies content filtering by default, **on input as well as output**. Gemini as configured
here does not surface this, so it is a genuinely new failure mode — and this app feeds
player-typed words straight into the prompt.

A blocked request returns HTTP 400 with `code: "content_filter"`. It is permanent for that content,
so it must not be treated as a transient error and retried, and it must not silently become a
zero-score round.

Decide:
- What the player sees when their answer trips the filter. A blunt error, or something in the
  game's voice?
- Whether a filtered answer should be scored 0 by the heuristic instead of failing the whole round.
  One offensive entry currently would take down the scoring of the other three valid answers.
- Whether this is desirable moderation the game should lean into — the filter blocks slurs before
  the model sees them, which the game does not currently do at all — or an obstacle to route around.
- Whether to raise thresholds to "high only" to reduce false positives on innocuous words, given
  single-word answers give the filter very little context and non-English words are riskier.
- Whether `withFallback` should catch this and hand off to the heuristic, or whether that would
  wrongly launder blocked content into a scored round.

## Answer

Approved as specified. A `content_filter` 400 is caught distinctly from transient failure and never retried. The affected category scores 0 with player-facing feedback; the other three categories score normally. Thresholds raised to 'high only' if false positives appear. See spec section 8.
