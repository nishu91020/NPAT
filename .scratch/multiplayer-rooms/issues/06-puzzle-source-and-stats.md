# What puzzle does a room play, and what does it do to the streak?

Type: grilling
Status: open
Blocked by: 01

## Question

The daily puzzle is deterministic and global: `getDailyPuzzleData(dateStr)` hashes the date to a
letter, the bonus challenge is generated once per date and shared across replicas, and a player's
streak and stats live in `localStorage` under `npat_game_stats_v1` / `npat_today_result_v1`. A room
has to be placed against all of that.

Decide:

- **Which letter a room plays.** Today's daily letter, or a fresh random one per room (the practice
  path already generates random puzzles with a per-request random bonus challenge)? If a room plays
  the daily letter, everyone in it burns their one daily attempt together — and anyone who already
  played solo this morning arrives knowing the answers.
- **Whether a room round counts toward the daily streak** and toward `gamesPlayed`, or whether
  multiplayer results are recorded separately, or not recorded at all. Note `GameResult` already
  carries a `mode` field (`'daily' | 'practice'`), so there is an obvious place for a third value —
  and note that the streak is computed in *two* places (`App.tsx#handleSubmitAnswers` and
  `storage.ts#recordGameCompletion`) which both have to agree.
- **Whether the stored shape changes**, and therefore whether the `_v1` key suffixes must be bumped.
  The loaders only shallow-merge over `DEFAULT_STATS`, so a changed shape without a bump is a
  silent corruption.
- **What the "already played today" guard means in a room.** `hasPlayedTodayOfficial` currently
  locks the solo daily. Does it lock you out of a room too?
- **Whether a multiplayer result should be shareable** the way the solo result is (`shareCard.ts`),
  and whether that share is of your score or of the room's leaderboard.

If the answer is "rooms play their own letter and touch nothing in `localStorage`", say so
explicitly — it is the cheapest answer and it would close several fog patches at once.
