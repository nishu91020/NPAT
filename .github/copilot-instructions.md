# Copilot Instructions — Letters Daily (NPAT)

Daily "Name, Place, Animal, Thing" word puzzle. React 19 + Vite 6 + Tailwind v4 frontend served by an
Express server that also proxies answer judging to a model on Microsoft Foundry, with a local
heuristic judge as the fallback.

⚠️ **The source carries no comments.** They were removed deliberately, so this file and
`docs/ARCHITECTURE.md` are now the *only* record of why the code is shaped the way it is — and most of
it is shaped by bugs that actually happened. Read both before changing anything load-bearing, and put
new reasoning here rather than in a comment that will be stripped again.

## Commands

```bash
npm install
npm run dev      # tsx src/server/main.ts — Express + Vite middleware on http://localhost:3000
npm run lint     # tsc --noEmit
npm test         # vitest run (unit only; no emulator needed)
npm run azurite  # start the local blob emulator, needed by test:integration
npm run test:integration   # includes *.integration.test.ts, requires Azurite
npm run test:watch
npm run build    # vite build -> dist/, then esbuild bundles src/server/main.ts -> dist/server.cjs
npm start        # node dist/server.cjs (requires NODE_ENV=production to serve dist/)
```

Integration tests are **excluded from `npm test`** so the default run needs no emulator. Azurite
must be started with `--skipApiVersionCheck` (what `npm run azurite` does): the storage SDK speaks a
newer API version than the emulator recognises and is rejected otherwise.

Tests are Vitest, configured by `vitest.config.ts` — a **separate, deliberately plugin-free config**. Do
not point Vitest at `vite.config.ts`: loading `@tailwindcss/vite` fails in Vitest's node environment.
Run a single file or test with:

```bash
npx vitest run server/referee/scoring.test.ts
npx vitest run -t "awards each tier at its boundary"
```

To exercise an endpoint by hand while `npm run dev` is running:

```bash
curl "http://localhost:3000/api/health"
curl "http://localhost:3000/api/daily-challenge?date=2026-08-08"
curl -X POST "http://localhost:3000/api/validate" -H "Content-Type: application/json" \
  -d '{"letter":"I","answers":{"name":"Ivan","place":"India","animal":"Iguana","thing":"Ice"},"bonusChallenge":{"id":"long_words","title":"t","description":"d","icon":"Sparkles","ruleHint":"r"},"timeTakenSeconds":18}'
```

**LLM configuration is optional.** With nothing configured the app runs on the heuristic judge, which
is a supported mode, not an error — so always verify changes both with and without it.

Microsoft Foundry needs three variables (`AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_JUDGE_DEPLOYMENT`,
`AZURE_OPENAI_BONUS_DEPLOYMENT`) and **no secret**: auth is Entra ID via `DefaultAzureCredential`,
which resolves from `az login` locally. Setting *some but not all* of them exits at startup by
design. See `.env.example`.

Note that `npm start` still runs the Vite dev middleware unless `NODE_ENV=production` is set, and
`npm run clean` is Unix-only (`rm -rf`).

## Architecture

**One process, one port.** `src/server/main.ts` is the entry point for both tiers. In development it imports
Vite and mounts `vite.middlewares` in `middlewareMode`; in production (`NODE_ENV=production`) it serves
static `dist/` with an `app.get('*')` SPA fallback. There is no separate Vite dev server and no proxy
config — that is why the client can `fetch('/api/...')` with relative URLs.

**All source lives under `src/`, split into three tiers, and the dependency arrows only point inward to
`src/shared/`.**

- `src/shared/` — `contract.ts` holds the wire types both tiers must agree on; `puzzle.ts` holds the
  daily derivation both tiers run; `bonusChallenges.ts` holds the built-in challenge pool it draws
  from. Must stay isomorphic: no `window`, no `localStorage`, no Node
  built-ins, and it may not import from `src/client/` or `src/server/`.
- `src/server/` — server-only. `src/server/main.ts` is the composition root and the esbuild entry.
- `src/client/` — browser-only. Components import wire types from `../../shared/contract`, not from
  `../types`; `src/client/types.ts` holds only what never leaves the browser (`GameResult`, `GameStats`,
  `CategoryInfo`).

**`src/client/` must never import from `src/server/`.** That is what keeps the LLM SDK and the prompts
out of the browser bundle. Anything genuinely common goes in `src/shared/`, never imported across the
tier seam.

**Scoring is server-only and lives in exactly one place.** `src/server/referee/scoring.ts` owns the `SCORING`
constants, the speed ladder, the points mapping, and the totals. Judges never assign points and never see
the clock — `JudgeRequest` deliberately omits `timeTakenSeconds`. Adapters satisfying the `Judge` seam:
`createAzureJudge` and `heuristicJudge`, composed by `withFallback`. Selection in
`src/server/main.ts` is **Azure → heuristic**. To change how a round scores, edit `SCORING`; to change how
words are judged, edit an adapter.

⚠️ **The speed bonus requires all four answers to be valid.** It rewards a round answered well *and*
quickly, so one wrong answer forfeits it entirely — four blanks submitted instantly used to score 20.
Matching the bonus challenge is **not** required: a right answer that misses the bonus is still right.
The elapsed time is measured from a round-start timestamp in `CategoryInputForm`, never derived as
`timeLimitSeconds - timeLeft`, because losing a life resets the clock to 15 and that formula then
reported 45 seconds for a round that had already run past a minute. Note `/api/validate` reads
`timeTakenSeconds` and falls back to `DEFAULT_TIME_TAKEN_SECONDS` when it is absent or not a number —
a request using any other field name is silently scored at the default.

**Strict structured output is why the provider matters.** Azure adapters request
`response_format: { type: 'json_schema', strict: true }`, which requires `additionalProperties: false` on
every object and every property in `required`. Strict mode cannot express `maxLength`, so length limits
stay as prompt instructions and the parsers stay defensive. The judge schema is built by a function that
defines the category shape once and **inlines it four times** — no `$ref`/`$defs` on the wire, since
strict-mode support for references is unverified. Tests pin all of this.

**The model is not trusted with anything mechanically decidable.** Four guards sit between the judge
and the score, all added after live output was observed getting it wrong:

- **The target letter is settled in code, in both directions.** `withOnlyMatchingLetters` in
  `targetLetter.ts` blanks every answer that fails the letter check *before* the request reaches the
  model, and `JUDGE_SYSTEM_PROMPT` tells it the first letter is not its to judge; `enforceTargetLetter`
  then applies the ruling afterwards from the player's original words. The model got this wrong both
  ways: `Tiger` scored full marks for the letter S, and `Lizabeth` was failed for the letter L with
  "first letter mismatch". Withholding the answer is what stops the second, since a judge shown a
  blank cannot reject a word on letter grounds.
- `enforceBonusRule` in `bonusRule.ts` overrules the model on bonus rules that are properties of the
  letters. A `BonusChallenge` carries an optional `rule` — `{ scope, checkKind, checkValue }` — and
  when `checkKind` is anything but `'none'` the game decides the match itself. Asked to apply one
  identical challenge to one identical set of answers **eight times, the model gave three different
  verdicts** and scores from 65 to 80. Applied in `evaluateRound`, not inside a judge, so the
  heuristic fallback is held to the same rule. `checkKind: 'none'` means the rule needs world
  knowledge — a theme, a famous person, whether something is edible — and stays with the judge.
- `enforceSuggestions` in `suggestion.ts` drops any "Try: …" the game cannot stand behind — see the
  suggestion note under *Conventions*.
- **Field order in the schema is load-bearing.** `bonusEvidence` is generated *before* `bonusMatched`
  so the model reasons before committing; it was otherwise prone to asserting a bonus match its own
  feedback then contradicted. The evidence shapes generation only and is deliberately dropped rather
  than carried into `JudgeVerdict`. `bonusMatched` is additionally forced false when `valid` is false.
  For a challenge with **no** `rule`, `scoreVerdict` requires the judge *and* the per-category count to
  agree on `bonusChallengeMet` — a judge may be stricter than the threshold, never looser. For a
  challenge **carrying** a `rule`, `enforceBonusRule` has already settled `bonusChallengeMet` from the
  categories and the scope, so that veto no longer applies; over-claiming is still blocked, because
  both sites derive from the same settled categories.

⚠️ **A bonus rule's `scope` decides what "met" means, and it is not always a count.** `all` needs all
four answers, `some` needs `SCORING.bonusChallengeThreshold`, and a category key (`name`, `place`,
`animal`, `thing`) needs only that one. Counting *every* rule against a threshold of two was a real
bug: four of the seven challenges in the frozen prefix constrain a single category ("the Thing must be
edible"), so at most one answer could ever match and they were impossible to complete — and most of
the pool is single-category now. `rule` is optional
because challenges generated before it existed are still served from Blob storage; absent means
`some`, the historical behaviour.

Both judge failures were **intermittent**, so a single passing run proves nothing here. Re-run a live
check several times before believing a prompt change fixed something.

⚠️ **In a room, a `checkKind: 'none'` rule is settled once for the whole round, not once per player.**
`scoreRound` judges every racer in a separate call — deliberately, so one player's content-filter
rejection cannot take down everyone else's round — and a rule needing world knowledge ("at least 2
answers must relate to a colour") is the one thing those independent calls cannot be trusted with:
two players in one round were seen getting different bonus verdicts for equally good answers. So
`sharedBonusRuling` in `src/server/referee/roundBonus.ts` asks `createAzureBonusAdjudicator` once,
over every player's distinct answers together, at `temperature: 0`, and `applyBonusRuling` holds
every player to that one ruling. Bonus authority runs least-trusted last: the shared ruling overrules
the per-player judge, and `enforceBonusRule` overrules them both, so a mechanical rule is never
adjudicated at all. It is skipped for a lone racer, for a mechanical rule, and when nothing is
scoreable; a failed adjudication logs and falls back to the per-player rulings, because losing
consistency must never cost anybody their round. Solo play passes no ruling — there is nobody to be
inconsistent with. The adjudicator rules **only** on the bonus: validity and the target letter are
settled elsewhere, and a ruling on a word nobody wrote is dropped rather than trusted.

**Generated bonus challenges must pass two tests**, encoded in `BONUS_SYSTEM_PROMPT`: *possible*
(never ask a category to be something it cannot be — no Name is a plant) and *actually extra* (a rule
restating "starts with the target letter" is earned for free by every valid answer). Both were real
observed failures, the second caused by fixing the first. The second is also enforced in code:
`restatesTargetLetter` rejects a description that names the letter as a starting condition, and
throwing there engages `withBonusFallback` rather than serving the dud all day. The prompt alone was
not enough — it already forbade this when "The Place must be a capital city **starting with S**" was
generated, smuggling the letter back in as a trailing qualifier.

**Rule variety is engineered, not hoped for.** Rules are drawn from a named `RULE_FAMILIES` entry per
request, because the model otherwise anchors on whichever example it saw first and returns
near-identical challenges every round. The families are numerous and *specific* on purpose: the model
writes near-identical rules within a family, so the family count — not the number of rounds — is the
real ceiling on variety, and a broad family like "a shared theme" always came back as "at least 2
answers must relate to X". How a family is chosen is injected per caller: `ruleFamilyForDate` rotates
deterministically by date with a stride coprime to the list length, so consecutive days never repeat
and every family is used before any recurs, while rooms use `createRecentAvoidingPicker`. The
prompt additionally forbids alliterating the title on the target letter — twelve live generations for
S gave "Stretchy S Words", "Space Seekers", "Sporty Squad" and read like one challenge.

**The heuristic judge only claims what it can verify.** It awards the challenges that are checkable
from the word alone — length, vowel count, adjacent vowels, double letters, how a word ends — and
declines the knowledge-based ones rather than guessing. It is a degraded mode — it runs when no
provider is configured or the AI call fails — so scores are legitimately lower than an AI-judged
round. `judgedBy` on the response records which one ruled.

**Content filtering is a first-class failure mode, not an error path.** Azure filters *input* as well as
output, and this game feeds player-typed words into a prompt. A `content_filter` rejection must never be
retried and must never fall through to the heuristic, which would launder blocked content into a score.
Because the filter rejects the whole prompt without saying which answer caused it,
`src/server/referee/contentFilter.ts` + `azureJudge.ts` attribute it by submitting each non-empty
answer alone — each answer that reached the model, so wrong-letter ones are skipped, having been
blanked before it saw them — then re-judge with the blocked ones blanked. Those probes are **not
retries** — each carries different content, and a test asserts the original request is never repeated
unchanged.

**Puzzle generation is deterministic, not stored.** `getDailyPuzzleData(dateStr)` hashes the `YYYY-MM-DD`
string to pick a letter from `AVAILABLE_LETTERS` (Q/U/X/Y/Z are deliberately excluded) and a bonus
challenge, and derives `dayNumber` from a `2026-01-01` epoch. There is no database. Changing the hash,
the letter list, or the epoch retroactively rewrites every past puzzle — treat those as frozen constants.

⚠️ **The letter must also differ from yesterday's, and that rule has a sharp edge.** `letterIndexFor`
compares the raw hash index against the previous day's *resolved* index and, only on a match, moves it
on by a second hash-derived step. **Do not simplify that step to `+1`**: consecutive dates inside a
month already hash one apart, so `+1` lands on the next day's letter and cascades — it changed five
days in a row and still left a collision at the end. The lookback is bounded (five days) rather than a
chain to the epoch, so this is a local rule, not an O(days-since-launch) walk. Adding it moved three
dates in 120 years (`2031-01-01`, `2033-01-01`, `2138-01-01` — all year boundaries, all future) and
nothing on or before the day it shipped; `puzzle.test.ts` pins that exact set, so a change that
rewrites any other date fails loudly.

⚠️ **`BONUS_CHALLENGES` is part of that frozen set, but only its first `DETERMINISTIC_CHALLENGE_COUNT`
entries.** The daily derivation indexes that prefix, never the whole array — it was
`% BONUS_CHALLENGES.length`, which meant appending a single challenge silently rewrote which one every
past date resolved to. The pool lives in `src/shared/bonusChallenges.ts` (not `puzzle.ts`), and the
prefix is structural rather than a convention: `FROZEN_CHALLENGES` holds those seven,
`EXTRA_CHALLENGES` holds everything since, `BONUS_CHALLENGES` spreads the two together and
`DETERMINISTIC_CHALLENGE_COUNT` is `FROZEN_CHALLENGES.length`. **Add challenges to
`EXTRA_CHALLENGES`** — appending there cannot shift the prefix and the count cannot drift from the
array. Reordering, removing or adding inside `FROZEN_CHALLENGES` still rewrites the past.
`puzzle.test.ts` pins golden letter/challenge/`dayNumber` values for known dates;
`bonusChallenges.test.ts` pins the prefix and its order, and holds every challenge to a rule, unique
id and title, a scope the scorer understands, and the 25/85-character limits the banner can render.

**The daily bonus is generated once per date, and shared across replicas.** Two layers, both
required: `cachedPerDate` in `src/server/bonus/types.ts` caches the in-flight promise in process, and
the `DailyChallengeStore` seam (`src/server/bonus/store.ts`) is the source of truth every replica reads.
**The in-process map alone is only correct for a single replica** — without the store, each replica
generates and serves its own daily challenge, which is a bug this project has already had once. A
replica publishes with `putIfAbsent`, so the first writer wins and the rest adopt that value rather
than overwriting it. Room rounds are intentionally random per request.

Adapters: `createBlobStore` (production and Azurite), `createMemoryStore` (tests), `nullStore`
(unconfigured, degrades to per-process caching). Set `DAILY_CHALLENGE_STORAGE` to enable it —
a blob endpoint in Azure, or `UseDevelopmentStorage=true` against Azurite locally.

**Scoring failure is not silently faked.** The client has no local validator. If `/api/validate` fails,
`useDailyGame` surfaces an error that `DailyGameScreen` renders, and the round is **not** recorded, so
streak stats cannot be corrupted by a guess. The puzzle *fetch* still falls back to
`getDailyPuzzleData` so the letter renders offline.

**Telemetry is optional and never load-bearing.** `src/server/telemetry/` holds a `Telemetry` port with a
no-op adapter, so call sites record unconditionally without null checks, and a `neverThrows` wrapper
means a telemetry bug cannot fail a player's round. Domain facts ride as attributes on the request
span the auto-instrumentation already created, landing as `customDimensions` on request telemetry —
one query answers "which judge ruled", at no extra ingestion cost. See
`.scratch/azure-deployment/TELEMETRY.md` for the queries.

⚠️ **`src/server/telemetry/init.ts` must stay the first import in `src/server/main.ts`.** The OpenTelemetry
instrumentations patch `http` as they load, so anything imported earlier is never instrumented and
its telemetry vanishes silently. It also calls `dotenv.config()` itself, because it runs before
`src/server/main.ts` reaches its own. Init is wrapped in try/catch: the exporter throws synchronously on a
connection string it cannot parse, and unguarded that would crash the server before it listens — a
typo in one env var taking the whole game down.

**State and persistence.** No router and no state library. **`App.tsx` owns only the current view and
the chrome** — header, footer, the two modals, the sound toggle — and renders one of three screens:
`LandingScreen`, `RoomScreen`, `DailyGameScreen`. **`src/client/` is grouped by feature the way
`src/server/` is grouped by domain** — `layout/` (Header, AppFooter), `modals/` (HelpRulesModal,
StreakStatsModal), `seo/` (SeoFaqSection),
`landing/`, `daily/` (its hook, screen, LetterBanner, CategoryInputForm, ValidationResultCard,
judgedBy, shareCard) and `rooms/` (useRoom, roomClient, RoomScreen and the create/join forms), with
`styles/` alongside. Each folder holds its own hook *and* its own components. There is no
`components/` folder any more; a file sits at the client root only when more than one feature needs
it (`audio.ts`, `storage.ts`, `types.ts`, `categories.ts`). **The room forms live in `rooms/` even
though `landing/` renders them** — they are about taking a seat, not about the landing page.
Components stay presentational and hooks keep the state. **`LandingScreen` only chooses a view**: it holds the `intent`
(`null`/`'create'`/`'join'`) and renders `LandingHero` plus one of `LandingModeCards`,
`CreateRoomForm`, `JoinRoomForm`. **Do not merge the two room forms back into one.** They were one
form threaded with `intent === 'create' ? … : …` in five places — title, code field, submit icon,
submit label, validity — and neither flow could be read without running the other in your head. They
share only `RoomFormPanel` (titled panel with back, error, primary submit) and `RoomNameField`; the
player's name lives in `LandingScreen` so it survives switching forms, while the code lives in
`JoinRoomForm` because it means nothing anywhere else. **Each mode's state lives in its own hook and `App` composes them**:
`src/client/daily/useDailyGame.ts` owns the puzzle, today's result, the `/api/validate` call and its error;
`src/client/daily/useGameStats.ts` owns the persisted stats and is the only caller of
`recordGameCompletion`, which `useDailyGame` reaches through an injected `onCompleted`;
`src/client/rooms/useRoom.ts` owns the seat token, the player identity, the staleness epoch, the polling
loop and every room action, and returns one `RoomController`. **Do not move mode state or mode
transitions back into `App.tsx`** — it decides only which view is on screen, which each hook asks for
through injected callbacks (`onStarted` for the daily round, `onEntered`/`onExited` for rooms). A
transition belongs to the hook that causes it: `daily.start()` and `rooms.create/join` run the whole
sequence and fire the callback themselves rather than returning a flag a caller has to remember to
act on. The room snapshot and the timestamp it arrived at are one piece of
state on purpose: a countdown measured against a timestamp from a different poll than the room it
belongs to is wrong. Persistence is `localStorage` via `src/client/storage.ts` under versioned keys
`npat_game_stats_v1` / `npat_today_result_v1` / `npat_player_v1` / `npat_room_seat_v1` — bump the
`_v1` suffix when the stored shape changes, since loaders only shallow-merge over `DEFAULT_STATS`.

⚠️ **There is one game mode: the daily puzzle.** Practice mode was removed — there is no
`/api/practice-challenge`, no mode toggle, and nothing in the client draws a random solo round.
`getRandomPuzzleData` and the random bonus source (`randomBonus` in `src/server/main.ts`) survive
because **rooms** use them for each round's letter and challenge. Saved rounds still carry
`GameResult.mode`, which is why it is optional and read-only: rounds stored while practice existed
say `'practice'` and have a *random* `dayNumber`, so history reads the field to label them honestly
rather than showing a daily challenge they never were. Nothing writes it.

**Audio is synthesized, not loaded.** `src/client/audio.ts` generates every sound with the Web Audio API
through a lazily-created shared `AudioContext`. There are no audio assets. Every function no-ops when the
context is unavailable and swallows errors, because browsers block audio before user interaction.

⚠️ **Muting belongs to `audio.ts`, not to callers.** `setMuted()` sets a module flag that
`getAudioContext()` honours, so all four sound functions are gated at the source and `App` only has to
mirror its `soundEnabled` state into it once. It was previously a prop threaded through components and
checked at the call site — which meant the two checks that existed worked and the **eighteen**
`playClickSound()` sites did not, so the mute button silenced the timer tick and the win jingle while
every button click still beeped. Never reintroduce a `soundEnabled` check around a `play*` call.

## Conventions and gotchas

- **Every adapter takes an injected client.** `createAzureJudge(client, deployment)` and
  `createAzureBonusSource(client, deployment)` accept a client rather than constructing one — that is
  what makes them testable. See the fake clients in `src/server/referee/azureJudge.test.ts` and
  `src/server/azure/client.test.ts`. Always throw on a malformed response so `withFallback` engages.
- **The `model` argument is the *deployment* name**, not the model name — the single easiest thing to get
  wrong on Azure. Deployment names ride on the `AzureClient` object.
- **Do not use the SDK's `AzureOpenAI` class.** It requires an `apiVersion` and rewrites requests onto the
  legacy `/openai/deployments/{name}/` path. The base `OpenAI` client is used instead, with `apiKey` set
  to a token-provider function that the SDK calls per request — which is what refreshes expiring Entra
  tokens. The scope is `https://ai.azure.com/.default`; the older `cognitiveservices` scope 401s here.
  Both facts are pinned by tests.
- **Bonus challenge icons are constrained at the source.** `RENDERABLE_ICONS` in
  `src/server/bonus/icons.ts` is the list offered to the model *and*
  the clamp applied to its answer. It must stay in lockstep with `ICON_MAP` in `LetterBanner.tsx`.
- **A wrong answer carries a `suggestion` — and so does a right one that missed the bonus.** The judge
  returns one example that would have scored better; the result card renders it as "Try: …" for an
  invalid answer and "Bonus: …" for a valid one. The second case exists because **the bonus is scored
  per category** (`validAnswerWithBonus` vs `validAnswer`), so a category that missed it lost points of
  its own whether or not the round met the challenge overall. `bonusRuleApplies` decides where that
  advice is honest: a rule naming one category refuses the other three the bonus outright in
  `enforceBonusRule`, so there is no answer they could have given and they are told nothing.
  `suggestion` is `undefined` rather than `''` when absent, and `enforceSuggestions` in `suggestion.ts`
  drops any the game cannot stand behind: a suggestion is the game claiming "this would have worked",
  so it is held to the target letter and the checkable part of the bonus rule. Under letter H with a
  "must contain `hh`" challenge, a rejected Name was offered `Rhythm`: not a name, not an H, no double
  H. A suggestion offered **for the bonus** is held to a higher bar than a mere correction — it must
  satisfy the rule even under a `some` scope, since earning the bonus is its whole job, whereas a
  correction failing a `some` rule may simply be one of the answers that never had to match. A
  suggestion that merely repeats the rejected answer is dropped too.
  ⚠️ Whether the suggested word is a *real* member of its category stays with the judge — it is world
  knowledge, not mechanically decidable. Asking harder for bonus-satisfying words pushes on exactly
  that seam: under a double-letter rule for S, `Sam` was advised as `Samm`. The prompt forbids
  inventing or padding words, but nothing in code can catch it.
- **Streak math lives in exactly one function.** `streakAfterCompletion(stats, dateKey)` in
  `storage.ts` decides what a completed round makes the streak; `recordGameCompletion` persists it and
  `projectedStreak` is what `useDailyGame` puts on the result card, so the number shown and the number
  saved cannot drift. It used to exist twice — `useDailyGame.ts#nextStreak` recomputed it
  independently — and it is not worth reintroducing that.
- ⚠️ **A stored streak is only true on the day it was written; `loadGameStats` decays it on read.**
  The persisted `currentStreak` is a record of the last completed round, so once `lastPlayedDate` is
  older than yesterday the chain is broken and `loadGameStats` returns `0`. Without that, a streak
  stayed on screen indefinitely and only reset when the player next submitted — the header claimed a
  live streak for someone who had not played in weeks. The decay is **read-only**: nothing writes it
  back, `lastPlayedDate` stays the record, and `recordGameCompletion`/`projectedStreak` deliberately
  read the raw value so they can tell "played yesterday" from "chain long dead".- **`judgedBy` is the provenance field, and it is persisted.** It is typed in `src/shared/contract.ts` and
- **`POST /api/rooms` is rate limited; nothing else about rooms is.** `createRateLimiter` in
  `src/server/rooms/rateLimit.ts` keys on client IP, defaults to 10 creations per 10 minutes
  (`ROOM_CREATE_LIMIT` / `ROOM_CREATE_WINDOW_SECONDS`), and refuses with `429` + `Retry-After` and the
  usual `{ error }` body so the client's existing banner shows it. Create is the only room endpoint an
  anonymous caller can reach without a seat token, and each call writes a new room. **Do not extend it
  to polling** — polling every `ROOM_POLL_MS` is how the game is played. Only *allowed* requests are
  counted, so a client stuck retrying still recovers when the window drains.
- ⚠️ **The room-create limiter is per replica (`limit × replicas`, up to 5× on the deploy defaults) and
  depends on `trust proxy`.** It is a guard against a runaway client, not a quota; a precise global
  limit wants a cache, not a blob write per attempt. `app.set('trust proxy', TRUST_PROXY_HOPS)`
  (default `1`, the Container Apps ingress) is what makes `req.ip` the caller rather than the ingress —
  at Express's default of `false` every visitor shares one bucket, and set too high callers can spoof
  `X-Forwarded-For` for a fresh bucket per request.
- ⚠️ **A room player id names a seat; the seat token owns it.** Ids are public — `toView` sends every
  player's id to every player, and results carry them — so `authorize()` in `roomState.ts` checks the
  server-issued `token`, and **every** room entry point goes through it, reads included. Authorising
  on the id alone let anyone who read a room submit as another player (and `submit` is idempotent, so
  the impersonated blank buried the real answers), act as the host, or mark a rival absent. The token
  is issued once by `create`/`join`, returned as `RoomView.youToken` only to that caller, and kept in
  `localStorage` under `npat_room_seat_v1` so a refresh can reclaim the seat.
- **Judging is claimed for a *round*, not just a phase.** `claimStillHolds(room, roundNumber)` gates the
  publish, because a claim that went stale during a slow model call can return to a room that is
  judging the *next* round — publishing there scored one round twice and dropped the other.
  `start` also authorises against the room as read *before* drawing a puzzle, since drawing one is an
  AI call and a 403 afterwards has already paid for it.
- **A room poll only writes when it has something to save.** `touch()` returns whether the heartbeat
  is worth persisting (every ~5s, well inside `presenceTimeoutSeconds`); reaping and deadlines are
  re-derived on every load, so a view is correct either way. Eight players polling used to mean ~5
  conditional writes a second against one blob, which the judging publish has to win.- **`judgedBy` is the provenance field, and it is persisted.** It is typed in `src/shared/contract.ts` and
  optional only so rounds saved before it existed still parse. Because it lives inside saved rounds in
  `localStorage`, values from earlier releases arrive forever — `'gemini'` from the Gemini era, and
  `undefined` from before the field. Use `isAiJudged()` in `src/client/daily/judgedBy.ts` rather than comparing
  values inline, and never weaken it to a truthiness check (`undefined !== false` was a real bug that
  showed the AI badge on heuristic rounds).
- **Types are split by who needs them.** Wire types live in `src/shared/contract.ts` (`CategoryKey`,
  `DailyPuzzle`, `ValidationResponse`, `JudgedBy`, …); browser-only shapes live in `src/client/types.ts`
  (`GameResult`, `GameStats`, `CategoryInfo`); judge-internal shapes live in `src/server/referee/types.ts`.
  Put a new type where its *narrowest* audience is — promoting to `src/shared/` is what makes it a contract.
  Components define their own local `...Props` interface and are typed `React.FC<Props>`
  with named exports; only `App.tsx` uses a default export.
- **Styling is hand-written CSS in `src/client/styles/`, never utility classes in JSX.**
  `index.css` keeps `@import "tailwindcss";` **for Preflight only** — the component CSS relies on that
  reset (`box-sizing: border-box`, zeroed button/input chrome, `border: 0 solid`) — then imports
  `tokens.css`, `base.css`, and one file per component area. There is no `tailwind.config.js`; do not
  add one, and do not reintroduce utility classes or `@apply`.
- **`tokens.css` owns every colour, font and shadow value** as `:root` custom properties, copied
  verbatim from the Tailwind v4 defaults. It cannot be deleted in favour of Tailwind's own variables:
  v4 emits theme variables only for utilities it finds in the source, and there are none left, so
  `var(--color-slate-900)` would resolve to nothing.
- **Class names are semantic and conditional styling is a modifier class**, not a ternary swapping
  utility bundles — `` className={`room__row${row.rank === 1 ? ' room__row--winner' : ''}`} ``.
  Shared primitives live in `base.css` (`.panel`, `.btn-primary`, `.btn-outline`, `.chip`, `.alert`,
  `.field-label`, `.answer-input`, `.modal*`, `.spinner`); everything else is scoped to its component
  file. Icon size and colour come from the parent via descendant `svg` selectors, which is why most
  `lucide-react` elements carry no `className`.
- ⚠️ **No inline `style` attributes, and dynamic values must not bring one back.** The timer bar's
  `width: {percent}%` was the only one; it is now a native `<progress className="timer-bar">` styled
  through `::-webkit-progress-value` / `::-moz-progress-bar`.
- **Design language is deliberately flat and geometric**: square corners (no border-radius), 2px
  borders and 4px left-accent rules, hard offset shadows (`--shadow-hard-*`), 0.625rem/900-weight
  uppercase micro-labels at `letter-spacing: 0.1em`, 48px touch targets, and a
  slate/`indigo-600`/rose/emerald/amber palette. All icons come from `lucide-react`.
- ⚠️ **A few "accent" rules paint a uniform border colour, and always did.** `border-l-4
  border-amber-500 border-y border-r border-amber-200` reads as an amber-500 spine in an amber-200
  frame, but Tailwind sorts colour utilities by family then shade, so amber-500 came later and won on
  every side; likewise `bg-white` beat `bg-amber-50` on the room's match-complete card. The CSS
  reproduces what was actually rendered — "fixing" these is a design change, not a port.
- **`playClickSound()` is called unconditionally** in components, while `playTickSound` and the win/lose
  sounds are gated on the `soundEnabled` prop. Match the surrounding call site rather than assuming a gate.
- **The `@` alias** maps to the repo root in both `tsconfig.json` and `vite.config.ts`, but nothing uses it;
  existing code imports relatively (`../utils/audio`).
- **Do not change the HMR block in `vite.config.ts`.** It is driven by the `DISABLE_HMR` env var so AI Studio
  can disable file watching during agent edits.
- **SEO content is hand-maintained in two places**: the JSON-LD `WebApplication` + `FAQPage` blocks in
  `index.html` and the visible copy in `SeoFaqSection.tsx`. Both still hardcode scoring prose that has
  drifted from `SCORING` — the FAQ advertises "+5 to +10". Rendering these from `SCORING` is an open
  improvement.
