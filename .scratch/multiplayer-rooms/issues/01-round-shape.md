# What shape does a multiplayer round take?

Type: grilling
Status: resolved

## Question

The root decision of this map. Almost every other ticket reads differently depending on the answer,
so it is worth being slow here.

"Play together" can mean at least three quite different games:

- **A. Shared scoreboard, played apart.** Everyone in the room plays the same letter and bonus
  challenge whenever they like; the room is a leaderboard they appear on as they finish. Closest to
  what exists — a solo round plus a place to put the result — and it needs no synchronised clock, no
  live connection, and no round state beyond "who has submitted what".
- **B. A live synchronised race.** The host starts the round, everyone sees the same countdown, and
  answers are revealed together at the end. This is the game people usually picture, and it is also
  the one that makes the server authoritative for the first time in this project: the clock, the
  round start, and "everyone has submitted" all become server facts (see constraint 3 on the map —
  today the client owns all of them and simply reports `timeTakenSeconds` afterwards).
- **C. Turn-based / pass-and-play.** One player at a time. Cheapest to build, least like the game.

Decide:

- Which of these the room is — or which of them it is *first*, if one is a stepping stone.
- Whether a room plays **one round and ends**, or is a **session of many rounds** with the same
  people. This changes whether a room is a short-lived object or something that has to survive
  between rounds.
- What "the round is over" means: everyone has submitted, or the clock ran out, or the host said so.
  Under B the three can disagree, and the answer decides whether a slow player blocks the room.
- Whether the lives mechanic survives contact with a shared round. Today losing a life *extends*
  one player's clock by 15 s, which under B means players finish on different clocks in a race that
  is supposed to be fair.
- Whether spectating — being in the room without playing this round — is a thing that exists.

⚠️ Answer this in terms of the experience wanted, not the technology. The transport and storage
questions are already out being researched in
[Where can shared room state live on this deployment?](02-research-room-state.md) and
[How does realtime transport fit this server?](03-research-realtime-transport.md), and both are
deliberately being answered for the general case so that this decision is not quietly made by
whatever was easiest to build.

## Answer

**A live synchronised race — option B.** The host starts the round, everyone runs one shared
countdown, and answers are revealed together at the end.

- **A round is a session of many rounds** (user-confirmed). After each reveal the room returns to
  the lobby and the host starts the next. Session standings accumulate across rounds — a one-round
  room is just the case where nobody starts a second.
- **A round ends on whichever comes first: every player has submitted, or the timer expires**
  (user-confirmed). No host override. A slow player therefore cannot hold the room hostage beyond
  the timer everyone already agreed to, and a room that answers quickly is not left waiting.
  Whatever an unsubmitted player has typed stands as their submission when time runs out.

⚠️ **The two below were recommendations the user did not explicitly rule on. Treat as provisional.**

- **Lives do not survive into multiplayer** (recommended, unconfirmed). Today a timeout costs a life
  and *adds 15 seconds*, which in a synchronised race means players run different-length clocks and
  destroys the fairness the shared countdown exists to create. One shared clock, one deadline.
  Lives stay exactly as they are in the solo game.
- **No spectator role in v1** (recommended, unconfirmed). Someone who opens the invite link
  mid-round waits in the lobby and watches the reveal with everyone else — spectating in practice,
  without adding a concept the whole model then has to carry.

### What choosing B costs, and one thing it buys

**Costs.** The server becomes authoritative for the first time in this project. It must own the
round's start time, its deadline, and the decision that the round is over — none of which exist
today, where `CategoryInputForm` holds the clock and the server only ever sees a finished
submission. It also needs something to advance a room whose players have all gone quiet, on a
service that scales to zero.

**Buys.** `timeTakenSeconds` stops being self-reported by the browser. The server started the
round, so it knows how long it took — closing a trust hole that was harmless while you only ever
competed against yourself, and would not have been once a speed bonus decides who beat whom.

### Follow-on

A throwaway state-machine prototype was built and drives this shape through the cases that are hard
to reason about on paper: [prototype/room-state.html](../prototype/room-state.html). It surfaced one
design bug — see the grace-period note on
[How is a room created, joined, invited to, and ended?](04-room-lifecycle-and-identity.md).
