# 06 — Prove the Azure judge rules as well as Gemini

**What to build:** evidence, before cutover, that swapping providers has not made the game judge
worse. A repeatable harness scores the same set of answers through both providers and reports where
they disagree.

This is the gate on ticket 07. Gemini must still be present and working for this to run, which is
why retirement comes last.

**Blocked by:** 02, 04

**Status:** skipped

Spec: [../../azure-foundry-migration/spec.md](../../azure-foundry-migration/spec.md) §10

- [ ] A golden set of ~100 answer-sets with the expected ruling recorded for each, covering: clearly
      valid answers, clearly invalid ones, wrong-letter and empty entries, the two mechanically
      checkable bonus rules, and the five knowledge-based ones
- [ ] Deliberate coverage of the game's India and South Asia bias — `Samosa`, `Shivaji`, `Nilgai` —
      since that is where a weaker model is most likely to differ
- [ ] The harness runs the set through both providers and reports per-category agreement, overall
      agreement, and a readable list of every disagreement
- [ ] It is a script run on demand, not part of `npm test` — every run costs money and there is no
      emulator
- [ ] Result recorded in a ticket comment: agreement percentage and a judgement on each
      disagreement, since some will be cases where neither provider is wrong
- [ ] Cutover gate: >=95% agreement on the clear-cut cases. Below that, stop and report rather than
      proceeding to 07
- [ ] Note the observed cost of one full run

## Outcome — skipped 2026-08-08

**Skipped by the user.** The formal golden-set diff was never run.

The evidence that stood in for it: live testing on the real deployment showed correct rulings on
exactly the knowledge the heuristic cannot supply — Shivaji as an Indian warrior king, Nilgai as an
Indian antelope, Samosa as South Asian food — and a correct refusal of the India bonus for Spain.
That is a handful of cases, not a hundred, and it was not blind or scored.

**What this means in practice:** there is no measured baseline. If Azure judges worse than Gemini
did in some category, nobody will notice from this evidence. For a hobby word game with a heuristic
fallback and no revenue that is a reasonable trade; the cost of being wrong is a mildly unfair round.

Worth knowing if quality is ever questioned later: the diff harness was never built, so re-running
it would mean building it *and* restoring Gemini, which ticket 07 removes. Rebuilding from git
history is possible but not free.