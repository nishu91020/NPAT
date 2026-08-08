# 03 — Handle answers blocked by the content filter

**What to build:** when a player types something Azure's content filter rejects, that one answer is
marked unscoreable and the rest of the round scores normally. The player is told plainly which
answer could not be checked, and the round still completes.

Azure filters input as well as output, by default, and this game feeds player-typed words straight
into a prompt — so this will happen, deliberately, as soon as someone tests the boundaries. Today
that would fail the whole round and waste three valid answers.

**Blocked by:** 02

**Status:** ready-for-agent

Spec: [../../azure-foundry-migration/spec.md](../../azure-foundry-migration/spec.md) §8

- [ ] A `content_filter` 400 is recognised distinctly from transient failures
- [ ] It is never retried — it is permanent for that content
- [ ] It does not fall through to the heuristic, which would launder blocked content into a score
- [ ] The affected category scores 0 with player-facing feedback; the other three score normally
- [ ] The wording is in the game's voice, not a raw API error, and does not accuse the player
- [ ] A model refusal surfaced via `finish_reason` on a 200 is handled too
- [ ] Tested with a fake client returning the documented `content_filter` 400 shape
- [ ] Note in a ticket comment whether thresholds need raising to "high only"; single-word answers
      give the filter little context and this game encourages Indian and South Asian answers
