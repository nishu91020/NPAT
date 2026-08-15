# What does the server grow, and what is the wire contract?

Type: grilling
Status: open
Blocked by: 01, 02, 03

## Question

Where the research lands. With the round shape decided, the storage options costed, and the
transport options compared, decide what actually gets built into the server.

Decide:

- **The module and its seam.** A `src/server/rooms/` tier alongside `referee/` and `bonus/`, with a
  port and adapters mirroring `DailyChallengeStore` — `createMemoryStore` for tests, a real adapter
  for production, and an honest degraded mode for the unconfigured case. Decide what that degraded
  mode *is*: the daily challenge degrades to per-process caching, which is merely suboptimal, but a
  per-process room is actively broken above one replica. Is unconfigured "single-replica only", or
  "multiplayer is off"?
- **Who owns the room's clock and its round state.** If the round shape made the server
  authoritative, this is where "the round started at T" and "the round ends at T+60" live, and
  something must advance a room whose players have all gone quiet — with no reliable timer on a
  service that scales to zero.
- **The wire contract.** Which messages or endpoints exist, their shapes, and where the types live.
  Wire types belong in `src/shared/contract.ts` by the existing rule; decide whether a realtime
  protocol earns its own shared module or joins the contract file.
- **Versioning.** A long-lived connection can outlive a deployment, and Container Apps revisions mean
  two versions of the server can be live at once. Decide whether the protocol carries a version and
  what a mismatched client is told.
- **Idempotency.** A submission that arrives twice — retry, reconnect, double-click — must score
  once. Decide what makes it identifiable.
- **Configuration.** Which environment variables appear, what `.env.example` gains, and what happens
  when they are set partially. The precedent is strict: a partial Foundry configuration exits at
  startup rather than silently degrading.

Reference the two research tickets for the options rather than re-deriving them:
[Where can shared room state live on this deployment?](02-research-room-state.md) and
[How does realtime transport fit this server?](03-research-realtime-transport.md).
