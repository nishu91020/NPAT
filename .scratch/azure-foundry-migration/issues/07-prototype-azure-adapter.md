# Draft the Azure adapter to react to

Type: prototype
Status: open
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
