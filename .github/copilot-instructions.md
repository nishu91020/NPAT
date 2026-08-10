# Copilot Instructions — Letters Daily (NPAT)

Daily "Name, Place, Animal, Thing" word puzzle. React 19 + Vite 6 + Tailwind v4 frontend served by an
Express server that also proxies answer judging to a model on Microsoft Foundry, with a local
heuristic judge as the fallback.

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
  daily derivation both tiers run. Must stay isomorphic: no `window`, no `localStorage`, no Node
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
bug: four of the seven built-in challenges constrain a single category ("the Thing must be edible"),
so at most one answer could ever match and they were impossible to complete. `rule` is optional
because challenges generated before it existed are still served from Blob storage; absent means
`some`, the historical behaviour.

Both judge failures were **intermittent**, so a single passing run proves nothing here. Re-run a live
check several times before believing a prompt change fixed something.

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
and every family is used before any recurs, while practice uses `createRecentAvoidingPicker`. The
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

⚠️ **`BONUS_CHALLENGES` is part of that frozen set, but only its first `DETERMINISTIC_CHALLENGE_COUNT`
entries.** The daily derivation indexes that prefix, never the whole array — it was
`% BONUS_CHALLENGES.length`, which meant appending a single challenge silently rewrote which one every
past date resolved to. Add challenges by **appending** below the marker in `puzzle.ts`; the extras are
drawn by practice mode and the random fallback, neither of which has to agree with history. Reordering
or removing anything in the prefix still rewrites the past. `puzzle.test.ts` pins the prefix, its order,
and golden letter/challenge/`dayNumber` values for known dates.

**The daily bonus is generated once per date, and shared across replicas.** Two layers, both
required: `cachedPerDate` in `src/server/bonus/types.ts` caches the in-flight promise in process, and
the `DailyChallengeStore` seam (`src/server/bonus/store.ts`) is the source of truth every replica reads.
**The in-process map alone is only correct for a single replica** — without the store, each replica
generates and serves its own daily challenge, which is a bug this project has already had once. A
replica publishes with `putIfAbsent`, so the first writer wins and the rest adopt that value rather
than overwriting it. Practice mode is intentionally random per request.

Adapters: `createBlobStore` (production and Azurite), `createMemoryStore` (tests), `nullStore`
(unconfigured, degrades to per-process caching). Set `DAILY_CHALLENGE_STORAGE` to enable it —
a blob endpoint in Azure, or `UseDevelopmentStorage=true` against Azurite locally.

**Scoring failure is not silently faked.** The client has no local validator. If `/api/validate` fails,
`App.tsx` shows an error and does **not** record the round, so streak stats cannot be corrupted by a
guess. The puzzle *fetch* still falls back to `getDailyPuzzleData` so the letter renders offline.

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

**State and persistence.** No router and no state library. All game state lives in `App.tsx` and is passed
down as props; `src/client/components/` holds presentational components only. Persistence is `localStorage` via
`src/client/storage.ts` under versioned keys `npat_game_stats_v1` / `npat_today_result_v1` — bump the `_v1`
suffix when the stored shape changes, since loaders only shallow-merge over `DEFAULT_STATS`.

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
- **Streak math exists twice**: `App.tsx#handleSubmitAnswers` computes a streak for the result object,
  while `storage.ts#recordGameCompletion` independently recomputes the persisted value. Update both.
- **`judgedBy` is the provenance field, and it is persisted.** It is typed in `src/shared/contract.ts` and
  optional only so rounds saved before it existed still parse. Because it lives inside saved rounds in
  `localStorage`, values from earlier releases arrive forever — `'gemini'` from the Gemini era, and
  `undefined` from before the field. Use `isAiJudged()` in `src/client/judgedBy.ts` rather than comparing
  values inline, and never weaken it to a truthiness check (`undefined !== false` was a real bug that
  showed the AI badge on heuristic rounds).
- **Types are split by who needs them.** Wire types live in `src/shared/contract.ts` (`CategoryKey`,
  `DailyPuzzle`, `ValidationResponse`, `JudgedBy`, …); browser-only shapes live in `src/client/types.ts`
  (`GameResult`, `GameStats`, `CategoryInfo`); judge-internal shapes live in `src/server/referee/types.ts`.
  Put a new type where its *narrowest* audience is — promoting to `src/shared/` is what makes it a contract.
  Components define their own local `...Props` interface and are typed `React.FC<Props>`
  with named exports; only `App.tsx` uses a default export.
- **Tailwind v4, CSS-first.** Wired through the `@tailwindcss/vite` plugin with a single
  `@import "tailwindcss";` in `src/client/index.css`. There is no `tailwind.config.js` — do not add one; extend
  via CSS. Styling is inline utility classes; there are no CSS modules or styled components.
- **Design language is deliberately flat and geometric**: square corners (no `rounded-*`), `border-2` /
  `border-l-4` accent rules, hard offset shadows like `shadow-[6px_6px_0px_0px_rgba(0,0,0,0.1)]`,
  `text-[10px] font-black uppercase tracking-widest` micro-labels, `min-h-[48px]` touch targets, and a
  slate/`indigo-600`/rose/emerald/amber palette. All icons come from `lucide-react`.
- **`playClickSound()` is called unconditionally** in components, while `playTickSound` and the win/lose
  sounds are gated on the `soundEnabled` prop. Match the surrounding call site rather than assuming a gate.
- **The `@` alias** maps to the repo root in both `tsconfig.json` and `vite.config.ts`, but nothing uses it;
  existing code imports relatively (`../utils/audio`).
- **Do not change the HMR block in `vite.config.ts`.** It is driven by the `DISABLE_HMR` env var so AI Studio
  can disable file watching during agent edits, and it carries an explicit "do not modify" comment.
- **SEO content is hand-maintained in two places**: the JSON-LD `WebApplication` + `FAQPage` blocks in
  `index.html` and the visible copy in `SeoFaqSection.tsx`. Both still hardcode scoring prose that has
  drifted from `SCORING` — the FAQ advertises "+5 to +10". Rendering these from `SCORING` is an open
  improvement.
