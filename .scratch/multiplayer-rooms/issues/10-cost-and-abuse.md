# What stops a room costing more than it should, or carrying content it shouldn't?

Type: grilling
Status: open
Blocked by: 05

## Question

Multiplying the judge by the number of players multiplies two things the project already treats
carefully: spend, and content that reaches the model.

Decide:

- **The spend ceiling.** The budget is $10/month with alerts at 80% actual and 100% forecast, and a
  judge call is ~5.4 s of a paid model. Decide the caps that keep a shared URL from becoming a bill:
  players per room, rounds per room per hour, rooms per client, and what a caller sees when they hit
  one. Note that `/api/validate` and `/api/generate-bonus` are unauthenticated and currently
  unthrottled, which is defensible for one round per person per day and much less so for rooms.
- **What a filtered word does to a room.** Azure filters *input*, and this game feeds player-typed
  words into a prompt. Today `contentFilter.ts` attributes a rejection by probing each non-empty
  answer alone and re-judging with the blocked ones blanked, and a filtered prompt is never retried.
  If the room is judged in one prompt, one player's word blocks everyone — so decide whether the
  blast radius is the room or the player, and whether that alone forces per-player judging
  regardless of what [How does a round score when several people answer the same
  letter?](05-shared-round-scoring.md) preferred on other grounds.
- **What other players are shown** when someone's answer is blocked. Telling the room that a named
  player's word was filtered is itself a disclosure; showing nothing is confusing.
- **Whether the heuristic judge is an acceptable fallback in a room.** It is a legitimate degraded
  mode solo, and `judgedBy` records it. In a competitive room, one player judged by the heuristic
  and another by the model is not a fair scoreboard — so decide whether a room falls back
  *together*, or not at all.
- **Bonus generation per room.** The daily challenge is generated once per date and shared; practice
  generates one per request. A room creating rounds on demand looks like practice, and practice is
  the expensive path.
