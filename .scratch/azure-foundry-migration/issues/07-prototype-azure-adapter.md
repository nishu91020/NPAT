# Draft the Azure adapter to react to

Type: prototype
Status: resolved
Blocked by: 03, 04

## Question

Make the migration concrete enough to argue with. Write a rough `createAzureJudge` satisfying the
existing `Judge` port and run it against the live deployment, so the discussion moves from
speculation to observed behaviour.

Use the `/prototype` skill. This is a throwaway to react to, not the implementation — the spec is
the deliverable.

What it should surface:
- The Gemini `contents` string split into `system` (persona and rules) and `user` (the round's data),
  and whether that split changes how the model behaves.
- The `Type`-enum schema rewritten as strict JSON Schema with `additionalProperties: false`
  throughout, and whether the existing nesting survives contact.
- Whether the "max 10 words" feedback instruction still holds, now that it lives only in the prompt
  and cannot be a schema constraint.
- Real latency for the Judge call, against the "Verifying Answers..." spinner the player watches.
- Whether the existing `heuristicJudge` fake-client test pattern ports cleanly to the new SDK.

Link the prototype branch or files here rather than pasting code into this ticket.

## Answer

**Superseded — not built.** The prototype existed to make the migration concrete enough to argue
with before the spec was written. The spec was drafted directly from research and approved without
it, so the questions this ticket would have answered move into the build instead: the system/user
split, the strict schema shape, and real Judge latency all get settled and verified in
`.scratch/azure-foundry-build/` ticket 02, which is written test-first against a fake client and
then verified live.

If the live verification in that ticket throws up surprises, reopen this as a real prototype rather
than debugging inside the implementation.