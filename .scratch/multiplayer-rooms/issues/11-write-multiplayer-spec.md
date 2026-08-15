# Write the multiplayer spec

Type: task
Status: open
Blocked by: 01, 04, 05, 06, 07, 08, 09, 10

## Question

Nothing to decide — assemble the settled decisions into the spec the user reviews. This is the
destination.

Write to `.scratch/multiplayer-rooms/spec.md`, covering:

- What multiplayer *is* in this game — the round shape, in the user's terms — and what explicitly
  does not change (the solo daily, `SCORING` for solo rounds, the referee guards, the ports).
- The room model: codes, invites, display names, player identity without accounts, host, capacity,
  lifetime, and cleanup.
- The chosen storage and transport, with the reason each alternative lost.
- The server module, its port and adapters, the wire contract, protocol versioning, and idempotency.
- Scoring for a shared round, including duplicates and the speed bonus, and where those rules live.
- The client changes: URLs and routing, where room state lives, and the screen flow, linking the
  prototype.
- Configuration: every new environment variable, and behaviour when unset or partly set.
- Failure modes and what each player sees: a dropped player, a failed judge call, a filtered word,
  a full room, an expired code, a client on an old protocol.
- Cost and abuse limits, with numbers.
- What implementation work follows, sized — this spec hands off to a separate effort.

Reference the decision tickets rather than restating their reasoning.
