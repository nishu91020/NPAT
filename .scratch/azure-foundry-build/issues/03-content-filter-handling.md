# 03 — Handle answers blocked by the content filter

**What to build:** when a player types something Azure's content filter rejects, that one answer is
marked unscoreable and the rest of the round scores normally. The player is told plainly which
answer could not be checked, and the round still completes.

Azure filters input as well as output, by default, and this game feeds player-typed words straight
into a prompt — so this will happen, deliberately, as soon as someone tests the boundaries. Today
that would fail the whole round and waste three valid answers.

**Blocked by:** 02

**Status:** done

Spec: [../../azure-foundry-migration/spec.md](../../azure-foundry-migration/spec.md) §8

- [x] A `content_filter` 400 is recognised distinctly from transient failures
- [x] It is never retried — it is permanent for that content
- [x] It does not fall through to the heuristic, which would launder blocked content into a score
- [x] The affected category scores 0 with player-facing feedback; the other three score normally
- [x] The wording is in the game's voice, not a raw API error, and does not accuse the player
- [x] A model refusal surfaced via `finish_reason` on a 200 is handled too
- [x] Tested with a fake client returning the documented `content_filter` 400 shape
- [x] Note in a ticket comment whether thresholds need raising to "high only"; single-word answers
      give the filter little context and this game encourages Indian and South Asian answers

## Notes

Done. 15 new tests (106 total).

**The hard part was attribution.** Azure's input filter rejects the whole prompt and does not say
which of the four answers caused it, so "score that one category 0 and let the other three score
normally" is not directly implementable from the error. On a rejection the adapter now submits each
non-empty answer *alone* to attribute the block, then makes one final call with the blocked answers
blanked so the survivors are still judged together — which matters, because bonus rules like "at
least 2 answers relate to India" are cross-category and cannot be evaluated per-answer.

**These probes are not retries.** Every probe carries different content, and the original request is
never repeated unchanged — there is a test asserting exactly that. They only run on the rare
filtered path.

**A test caught a real bug.** When something *outside* the answers trips the filter (the bonus
challenge text appears in every prompt, including probes), all four probes fail, and the final
blanked call was still filtered and threw uncaught. It now degrades to marking the whole round
unscoreable.

Empty answers are skipped when probing, so a sparse round costs fewer calls.

**Threshold note:** whether to raise thresholds to "high only" cannot be judged without live traffic.
Revisit after the golden-set run in ticket 06, which will exercise real Indian and South Asian
vocabulary where false positives are most likely.