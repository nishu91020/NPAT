# Prototype — the room state machine

⚠️ **Throwaway. Not production code, not imported by the app, not covered by `npm test`.**

Answers: *does the state model for a live synchronised race hold up?* — the round shape settled in
[What shape does a multiplayer round take?](../issues/01-round-shape.md).

## Run it

**Double-click `room-state.html`.** No build, no server, no install — it opens straight from disk.

Pick one of the 8 guided walkthroughs on the left and click **Run next step**; the narration says
what to look for, and the full room state re-renders after every action. Or ignore them and use the
free-play controls.

Checks, both optional:

```powershell
node --test .scratch\multiplayer-rooms\prototype\room-state.test.cjs   # 15 tests on the state machine
node .scratch\multiplayer-rooms\prototype\verify.cjs                   # page wiring + scoring drift
```

## What it encodes

| Decision | Where it came from |
|---|---|
| A live synchronised race, one shared clock | user |
| A round ends when everyone submits **or** the timer expires | user |
| **Duplicate answers do not score less** | user |
| Leaderboard ranks today's score; ties broken on time | user |
| A room is a session of many rounds; standings accumulate | user |
| No lives in multiplayer; no spectator role | recommended, **unconfirmed** |
| Late joiners sit out the round in progress | prototype default, **unconfirmed** |
| Host migrates to the longest-present player | prototype default, **unconfirmed** |
| Empty rooms close after a grace period, not instantly | **found by this prototype** |

## What it fakes

- **Judging.** A word is "valid" if it starts with the letter, and "bonus" stands in for a real
  rule. The real thing is an LLM call taking ~5.4 s. Nothing here says anything about judging.
- **The clock.** Time only moves when you push it, so you can stand inside a 60-second round.
- **Storage and transport.** Everything is in memory in one tab. The real thing spans replicas —
  see the two research documents.

## The one thing it found

Closing a room the moment its last player leaves means **a solo host destroys their own room by
pressing F5** — a refresh and a departure look identical to a server. Rooms now empty into a grace
period instead. Written up on
[How is a room created, joined, invited to, and ended?](../issues/04-room-lifecycle-and-identity.md).

## Keeping it honest

`room-state.js` copies the scoring constants from `src/server/referee/scoring.ts` by hand. `verify.cjs`
fails if they drift, so the numbers on screen stay the real ones.
