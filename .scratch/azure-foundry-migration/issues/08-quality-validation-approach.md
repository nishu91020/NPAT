# Decide how we prove the new judge is good enough

Type: grilling
Status: open
Blocked by: 03

## Question

How do we know the Azure judge rules at least as well as Gemini did, before committing to the
switch?

The judge makes subjective calls — is *Sid* a name, does *Samosa* count as an India connection —
so "it returns valid JSON" is not the bar. Research suggests a golden set of 100–200 answer-sets
with known-correct rulings, diffed between providers, at ≥95% agreement on clear-cut cases.

Decide:
- Whether formal validation is wanted at all, or whether spot-checking is proportionate for a hobby
  word game.
- If wanted: how many cases, who decides the correct ruling, and how the set gets built — hand
  written, or harvested from real rounds?
- The acceptance threshold, and what happens if Azure disagrees with Gemini on genuinely ambiguous
  cases where neither is wrong.
- Whether these cases become a permanent regression suite (they would need to be cheap or mocked to
  run, since every real call costs money and there is no emulator) or a one-off gate.
- Whether the bonus generator needs any validation, or whether "produces a renderable challenge" is
  sufficient.
