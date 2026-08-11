# Map: Rooms — play Letters Daily with other people

Label: `wayfinder:map`

## Destination

A **reviewed spec** for turning Letters Daily into a game you can play with other people: a player
enters a display name, then creates a room or joins an existing one by code, and invites others in.
The map is done when every decision that spec depends on is settled and the spec has been written
for review — implementation is a separate effort that follows.

## Notes

**Domain.** This is the first feature in this codebase with **state that outlives a single request
and is shared between players.** Everything today is either derived (`getDailyPuzzleData` hashes the
date), cached per date (`cachedPerDate` + `DailyChallengeStore`), or private to one browser
(`localStorage` under `npat_*_v1`). A room is none of those: it is mutable, hot, and several people
read and write it at once. That is the centre of gravity of this map.

**Four facts about the current system constrain almost every ticket here:**

1. **The app runs on Azure Container Apps at `minReplicas: 0`, `maxReplicas: 5`**
   ([DEPLOYED.md](../azure-deployment/DEPLOYED.md)). Two players in one room can land on two
   replicas, and a quiet moment can scale the whole app to zero. In-process room state is therefore
   wrong for the same reason the in-process daily-challenge cache alone was wrong — a bug this
   project has already shipped once and fixed with `DailyChallengeStore`.
2. **Judging costs ~5.4 s of wall clock per call** and runs against a paid model under a $10/month
   budget. One round today is one judge call. One round in a room of six is potentially six.
3. **The clock and the lives are client-side and per-player** (`CategoryInputForm` holds `timeLeft`,
   `lives`, and a `startedAtRef`; losing a life *adds* 15 s). Nothing about the current round is
   authoritative on the server, and the server never sees a round start — only a finished
   submission carrying its own `timeTakenSeconds`.
4. **There is no router and no state library** — all client state lives in `App.tsx`. An invite link
   needs a URL that means something, which is the first thing in this app to genuinely want one.

**Skills to consult.** `/grilling` and `/domain-modeling` for the decision tickets — the vocabulary
here (room, host, lobby, round, reveal, player) is new to the project and worth pinning down before
it leaks into type names. `/prototype` for the room flow. `/research` for the two AFK tickets.

**Standing preferences for this effort.**

- Stay inside the existing $10/month budget, and keep scale-to-zero if it can survive it.
- Reuse the seams that already exist rather than inventing parallel ones: a room store should look
  like `DailyChallengeStore` (port + `createBlobStore`/`createMemoryStore`/`nullStore` adapters),
  and scoring must stay in `server/referee/scoring.ts` rather than moving into a room module.
- The tier rule holds: `client/` never imports from `server/`, anything shared goes in `shared/`.

**Assumptions made while charting** (the user was away; reverse any of these and the map shifts):

1. **The destination is a spec, not an implementation.** Wayfinder plans by default and the previous
   effort in this repo worked the same way.
2. **Multiplayer is added alongside the solo daily, not a replacement for it.** "Convert this game
   into a multiplayer game" is read as "let people play it together", not "delete single player" —
   the daily puzzle, the streak, and the SEO landing surface are the product today.
3. **No accounts.** A player is a display name that lives in the browser, like the existing stats.
4. **Rooms are invite-only between people who know each other**, not public matchmaking with
   strangers. That keeps moderation light and is why there is no room-browser ticket.
5. **The current hosting stays.** The spec must fit Container Apps as deployed, not require a move.

## Decisions so far

- [What shape does a multiplayer round take?](issues/01-round-shape.md) — **A live synchronised
  race (B).** The host starts, everyone runs one shared countdown, answers reveal together. A room
  is a **session of many rounds** with accumulating standings, and a round ends when **everyone has
  submitted or the timer expires**, whichever comes first — no host override. Makes the server
  authoritative for the first time in this project, and in exchange `timeTakenSeconds` stops being
  self-reported by the browser. Lives and spectating provisionally dropped from multiplayer.
- ⚠️ [How does a round score when several people answer the same letter?](issues/05-shared-round-scoring.md)
  (part) — **Duplicate answers do NOT score less**, and the leaderboard ranks the score exactly as
  calculated today, breaking ties on time. **This is the biggest simplification on the map:**
  multiplayer adds no term to the scoring calculation, so `scoring.ts` needs no cross-player phase
  and players can be judged independently. The rest of that ticket (judging fan-out, partial
  failure) is still open.
- [Where can shared room state live on this deployment?](issues/02-research-room-state.md) — Use the
  **storage account that is already deployed**: Blob first, Table second. Redis does not fit the
  budget (smallest Managed Redis SKU is **$11.68/month** PAYG, more than the whole $10 budget; only
  a 1-year commitment fits), and Web PubSub is fan-out, not storage, at ~$49/month. Blob costs
  nothing extra, needs no new role, and `blobStore.ts` already runs every operation a room store
  needs — `putIfAbsent` via an ETag conditional write. Cost: ~5–20 ms per op and a retry loop for
  compound updates. **Session affinity is not a substitute** — it breaks on every deploy.
- [How does realtime transport fit this server?](issues/03-research-realtime-transport.md) — The
  feared Vite HMR upgrade collision **does not exist here**: in `middlewareMode` Vite runs HMR on
  its own port 24678, verified by running the server, so port 3000's upgrade path is uncontended
  (pin it with a test — it depends on `hmr.server` staying unset). Container Apps supports both
  WebSocket and SSE. Every option except Web PubSub needs a cross-replica backplane; **polling is a
  genuine contender** because the shared store is already the source of truth. Ranked: polling →
  SSE/`ws` → Web PubSub. ⚠️ `server.close()` does not close upgraded sockets — the existing
  graceful shutdown would need to.

## Prototypes

- [prototype/room-state.html](prototype/room-state.html) — the room state machine for a live race,
  driveable in a browser with 8 guided walkthroughs (double-click it; no build, no server). Backed
  by `room-state.test.cjs` (15 tests) and `verify.cjs`, which also fails if the prototype's copy of
  the scoring constants drifts from `src/server/referee/scoring.ts`. **It has already earned its
  keep**: it found that closing a room when its last player leaves means a solo host destroys their
  own room by pressing F5.

## Not yet specified

- **Disconnect, reconnect, and host migration.** Clearly coming — a player closing a laptop
  mid-round has to mean *something* — but what it means depends on whether a round is a live
  synchronised race or an async shared scoreboard
  ([What shape does a multiplayer round take?](issues/01-round-shape.md)). The transport half of
  this is now answered: whether the app can even *detect* a departure is a property of the chosen
  transport, and polling — the current front-runner — cannot, without explicit timeout logic.
  Revisit once the round shape is settled.
- **How multiplayer gets tested.** The repo tests with Vitest against a deliberately plugin-free
  config and has a Playwright skill available, but "two players in one room" is a shape neither
  currently covers. Sharpens once the transport is chosen — though the research already notes that
  polling and `ws` are both testable in a plain node environment, and that the "HMR is on its own
  port" fact wants a regression test of its own.
- **Telemetry for rooms.** `Telemetry` is a port with a no-op adapter and domain facts ride as
  attributes on the request span — but a long-lived socket is not a request, so the existing pattern
  may not reach. Revisit after the server architecture is settled.
- **Display names as user content.** Names are typed by a player and rendered to other people.
  Answers already pass through Azure's content filter on the way to the judge; names would not, and
  nothing in the app moderates them today. Sharpens once the room lifecycle is fixed.
- **Rematch, room history, and what a room remembers between rounds.** Whether a room is one round
  or a session of many is downstream of the round shape.
- **Whether rooms change the public surface** — the landing page, the JSON-LD, the FAQ copy, and
  what an uninvited visitor to a room URL sees.

## Out of scope

- **Building it.** The destination is a reviewed spec; implementation is a separate effort that
  follows, exactly as `azure-foundry-build/` followed `azure-foundry-migration/`.
- **Provisioning whatever infrastructure the spec picks.** An implementation act, and it cannot
  sensibly happen before the spec naming it is approved.
- **Accounts, login, and identity that persists across devices.** A real feature, independently
  valuable, and a prerequisite for none of the decisions here — a display name per room is enough to
  play. Bundling auth would make neither reviewable.
- **Chat, voice, or emotes in a room.** Adjacent social features, not part of "create a room, invite
  others, play together".
- **Changing how a solo daily round scores.** `SCORING`, the speed ladder, and the four referee
  guards are settled and provider-independent; this effort may *extend* scoring for shared rounds
  but must not disturb the solo path.
- **Public matchmaking, a room browser, or playing with strangers** — see assumption 4.
