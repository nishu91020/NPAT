# How does a round score when several people answer the same letter?

Type: grilling
Status: open
Blocked by: 01

## Settled (user, before the rest of this ticket was worked)

- ⚠️ **Duplicate answers do NOT score less.** Two players who write the same word both score it in
  full. This is the single biggest simplification available on this map: it means **multiplayer
  adds no term to the scoring calculation at all**, so each player is scored exactly as a solo
  round is scored today, `scoring.ts` needs no cross-player phase, and a round can be judged
  per-player with no dependency between players.
- **There is a leaderboard, ranked on the score as calculated today.** Rank by total score,
  **breaking ties on time** — in a race, whoever got there first is ahead. Players level on *both*
  score and time genuinely share a rank, and the next rank is skipped (1, 2, 2, 4).
- Because a room is a session of many rounds, there are **two** boards: the round leaderboard and
  the accumulated session standings. Both use the same ranking rule.

Pinned by the prototype at [prototype/room-state.html](../prototype/room-state.html) and its tests
(`room-state.test.cjs`): three players submitting identical answers score identically and share
rank 1, while identical answers at 5s and 40s differ only by the speed bonus.

## Question

What remains open, now that duplicates and the leaderboard are settled:

- **What happens to the speed bonus.** It currently requires all four answers to be valid and is a
  ladder on `timeTakenSeconds`. Every racer now starts at the same instant on a server-owned clock,
  so comparing elapsed times is finally fair — but decide whether the ladder is still the right
  shape when it is also the tiebreak that decides who won.
- **Is the bonus challenge the same for the whole room?** Almost certainly yes, but say so — and
  confirm meeting it stays per-category, per-player, as it is now.
- **How the judging fans out.** Six players is potentially six judge calls at ~5.4 s each. Decide
  whether they run in parallel and what the room sees while it waits. Note that "duplicates do not
  score less" removes the main argument for judging the room in one prompt, since no player's score
  depends on another's — so per-player judging is now the natural choice, and it also keeps one
  player's content-filter rejection from becoming everyone's problem
  ([What stops a room costing more than it should?](10-cost-and-abuse.md)).
- **What happens when judging fails for one player but not another.** Today a failed validation
  means the round is not recorded at all, deliberately, so a guess can never corrupt a streak. In a
  room, one player's failure must not silently void everyone else's round — or must it?
- **Where the multiplayer scoring rules live.** With no duplicate rule, this may be nothing more
  than a ranking function beside `scoring.ts` rather than a change to it.

⚠️ The solo daily path must come out of this unchanged — it is live and its scoring is settled.
