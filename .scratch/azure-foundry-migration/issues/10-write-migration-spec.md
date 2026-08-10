# Write the migration spec

Type: task
Status: resolved
Blocked by: 03, 04, 05, 06, 07, 08, 09

## Question

Nothing to decide — assemble the settled decisions into the spec the user reviews. This is the
destination.

Write to `.scratch/azure-foundry-migration/spec.md`, covering:
- What changes and what explicitly does not (the ports, the referee's scoring, the heuristic judge).
- The chosen model(s), deployment name(s), region, and deployment type.
- The exact SDK and client construction, including the auth mechanism and the v1 endpoint shape.
- The prompt restructuring and the strict JSON Schema for both call sites.
- Configuration: every environment variable, and behaviour when unconfigured or partly configured.
- Failure-mode handling: content filter, 429/5xx retries, model refusal, and what the player sees
  in each case.
- How Gemini is retired, and what happens to `judgedBy` in already-stored results.
- The quality bar and how it gets verified before cutover.
- What implementation work follows, sized — this spec hands off to a separate effort.

Reference the decision tickets rather than restating their reasoning.

## Answer

Resolved. The spec is written at `.scratch/azure-foundry-migration/spec.md` and was approved by the user on 2026-08-08. Implementation tickets follow in `.scratch/azure-foundry-build/`.
